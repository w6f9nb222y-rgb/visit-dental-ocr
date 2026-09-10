import { useMemo, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(null);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * ==========================================
   * 現在合わせてある帳票座標
   * ==========================================
   */

  const ROW_1_CENTER = 0.0550;
  const ROW_STEP = 0.0267;

  const COLUMNS = {
    patients: {
      label: "実患者",
      x: 0.4820,
      w: 0.0300,
      maxDigits: 2,
    },

    insurance: {
      label: "保険診療分",
      x: 0.5280,
      w: 0.0700,
      maxDigits: 5,
    },

    care: {
      label: "介護保険",
      x: 0.7970,
      w: 0.0600,
      maxDigits: 5,
    },
  };

  /*
   * ==========================================
   * ファイル選択
   * ==========================================
   */

  function handleFiles(event) {
    const selected = Array.from(
      event.target.files || []
    );

    if (!selected.length) return;

    setFiles(selected);
    setResults([]);
    setElapsed(null);
    setProgress(0);
    setStatusText("");
    setError("");
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);

        reject(
          new Error(
            `${file.name} を読み込めませんでした`
          )
        );
      };

      image.src = url;
    });
  }

  /*
   * ==========================================
   * セル切り抜き
   * ==========================================
   */

  function makeRawCell(
    image,
    day,
    columnKey
  ) {
    const column =
      COLUMNS[columnKey];

    const centerY =
      image.height *
      (
        ROW_1_CENTER +
        (day - 1) * ROW_STEP
      );

    const sourceHeight =
      image.height *
      ROW_STEP *
      0.68;

    const sourceY =
      centerY -
      sourceHeight / 2;

    const sourceX =
      image.width *
      column.x;

    const sourceWidth =
      image.width *
      column.w;

    const canvas =
      document.createElement("canvas");

    canvas.width =
      Math.max(
        60,
        Math.round(sourceWidth)
      );

    canvas.height =
      Math.max(
        28,
        Math.round(sourceHeight)
      );

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  }

  /*
   * ==========================================
   * グレースケール
   * ==========================================
   */

  function grayscale(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width =
      source.width;

    canvas.height =
      source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const gray =
        data[i] * 0.299 +
        data[i + 1] * 0.587 +
        data[i + 2] * 0.114;

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      data[i + 3] = 255;
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /*
   * ==========================================
   * 縮小してモアレを軽減
   * ==========================================
   */

  function reduceMoire(
    source,
    factor = 0.70
  ) {
    const canvas =
      document.createElement("canvas");

    canvas.width =
      Math.max(
        30,
        Math.round(
          source.width * factor
        )
      );

    canvas.height =
      Math.max(
        18,
        Math.round(
          source.height * factor
        )
      );

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  }

  /*
   * ==========================================
   * コントラスト強調
   * ==========================================
   */

  function increaseContrast(
    source,
    amount = 1.6
  ) {
    const canvas =
      document.createElement("canvas");

    canvas.width =
      source.width;

    canvas.height =
      source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      let value = data[i];

      value =
        (value - 128) *
        amount +
        128;

      value =
        Math.max(
          0,
          Math.min(
            255,
            value
          )
        );

      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /*
   * ==========================================
   * 固定閾値2値化
   * ==========================================
   */

  function threshold(
    source,
    thresholdValue
  ) {
    const canvas =
      document.createElement("canvas");

    canvas.width =
      source.width;

    canvas.height =
      source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const value =
        data[i] <
        thresholdValue
          ? 0
          : 255;

      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /*
   * ==========================================
   * OCR用に大きく拡大
   * ==========================================
   */

  function upscale(
    source,
    scale = 3
  ) {
    const canvas =
      document.createElement("canvas");

    canvas.width =
      source.width *
      scale;

    canvas.height =
      source.height *
      scale;

    const ctx =
      canvas.getContext("2d");

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise(
      (resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(
                new Error(
                  "画像変換に失敗しました"
                )
              );

              return;
            }

            resolve(blob);
          },
          "image/png",
          1
        );
      }
    );
  }

  /*
   * ==========================================
   * OCR文字整形
   * ==========================================
   */

  function cleanOCRText(
    text,
    columnKey
  ) {
    let value =
      String(text || "")
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/\D/g, "");

    const maxDigits =
      COLUMNS[columnKey]
        .maxDigits;

    if (
      value.length >
      maxDigits
    ) {
      value =
        value.slice(-maxDigits);
    }

    return value;
  }

  /*
   * ==========================================
   * 1枚OCR
   * ==========================================
   */

  async function recognizeCanvas(
    worker,
    canvas,
    columnKey
  ) {
    const blob =
      await canvasToBlob(
        canvas
      );

    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789,.",

      /*
       * PSM 7:
       * 1行のテキストとして認識
       */
      tessedit_pageseg_mode:
        "7",

      preserve_interword_spaces:
        "0",

      user_defined_dpi:
        "300",
    });

    const result =
      await worker.recognize(
        blob
      );

    return {
      value:
        cleanOCRText(
          result.data.text,
          columnKey
        ),

      confidence:
        Number(
          result.data.confidence ||
          0
        ),
    };
  }

  /*
   * ==========================================
   * セルを複数条件でOCR
   * ==========================================
   */

  async function recognizeCell(
    worker,
    image,
    day,
    columnKey
  ) {
    const raw =
      makeRawCell(
        image,
        day,
        columnKey
      );

    const gray =
      grayscale(raw);

    /*
     * 同じ数字を3通りで読む
     */

    const variant1 =
      upscale(
        increaseContrast(
          reduceMoire(
            gray,
            0.72
          ),
          1.55
        ),
        3
      );

    const variant2 =
      upscale(
        threshold(
          reduceMoire(
            gray,
            0.68
          ),
          160
        ),
        3
      );

    const variant3 =
      upscale(
        threshold(
          reduceMoire(
            gray,
            0.75
          ),
          175
        ),
        3
      );

    const attempts = [];

    for (
      const variant of [
        variant1,
        variant2,
        variant3,
      ]
    ) {
      attempts.push(
        await recognizeCanvas(
          worker,
          variant,
          columnKey
        )
      );
    }

    /*
     * 多数決
     */

    const counts = {};

    for (
      const attempt of
      attempts
    ) {
      if (!attempt.value) {
        continue;
      }

      counts[
        attempt.value
      ] =
        (
          counts[
            attempt.value
          ] || 0
        ) + 1;
    }

    const sorted =
      Object.entries(
        counts
      ).sort(
        (a, b) =>
          b[1] - a[1]
      );

    const bestValue =
      sorted[0]?.[0] || "";

    const agreement =
      sorted[0]?.[1] || 0;

    const matching =
      attempts.filter(
        (a) =>
          a.value ===
          bestValue
      );

    const avgConfidence =
      matching.length
        ? matching.reduce(
            (sum, item) =>
              sum +
              item.confidence,
            0
          ) /
          matching.length
        : 0;

    /*
     * 要確認判定
     */

    let warning = false;

    if (!bestValue) {
      warning = true;
    }

    /*
     * 3回中2回以上一致しなければ
     * 要確認
     */
    if (
      bestValue &&
      agreement < 2
    ) {
      warning = true;
    }

    /*
     * 桁数がおかしい場合
     */
    if (
      columnKey ===
        "patients" &&
      bestValue &&
      (
        Number(bestValue) >
          50 ||
        Number(bestValue) ===
          0
      )
    ) {
      warning = true;
    }

    if (
      columnKey !==
        "patients" &&
      bestValue &&
      Number(bestValue) <
        100
    ) {
      warning = true;
    }

    return {
      value:
        bestValue,

      warning,

      agreement,

      confidence:
        Math.round(
          avgConfidence
        ),

      attempts:
        attempts.map(
          (item) =>
            item.value ||
            "空"
        ),

      preview:
        variant1.toDataURL(
          "image/png"
        ),
    };
  }

  /*
   * ==========================================
   * 画像解析
   * ==========================================
   */

  async function analyzeImages() {
    if (
      !files.length ||
      isAnalyzing
    ) {
      return;
    }

    setIsAnalyzing(true);
    setResults([]);
    setElapsed(null);
    setError("");
    setProgress(0);

    const started =
      performance.now();

    let worker;

    try {
      setStatusText(
        "OCRエンジンを準備しています…"
      );

      worker =
        await createWorker(
          "eng",
          1
        );

      const allRows = [];

      /*
       * 31日 × 3セル ×
       * 選択画像枚数
       */
      const total =
        files.length *
        31 *
        3;

      let completed = 0;

      for (
        let fileIndex = 0;
        fileIndex <
        files.length;
        fileIndex++
      ) {
        const file =
          files[fileIndex];

        setStatusText(
          `${file.name} を読み込んでいます…`
        );

        const image =
          await loadImage(file);

        for (
          let day = 1;
          day <= 31;
          day++
        ) {
          const row = {
            id:
              `${fileIndex}-${day}`,

            fileIndex,
            fileName:
              file.name,

            day,

            patients: "",
            insurance: "",
            care: "",

            warnings: {
              patients: false,
              insurance: false,
              care: false,
            },

            diagnostics: {},
          };

          for (
            const key of [
              "patients",
              "insurance",
              "care",
            ]
          ) {
            setStatusText(
              `${fileIndex + 1}/${files.length}枚目　${day}日 ${COLUMNS[key].label} を解析中…`
            );

            const result =
              await recognizeCell(
                worker,
                image,
                day,
                key
              );

            row[key] =
              result.value;

            row.warnings[
              key
            ] =
              result.warning;

            row.diagnostics[
              key
            ] = result;

            completed++;

            setProgress(
              Math.round(
                (
                  completed /
                  total
                ) *
                  100
              )
            );
          }

          /*
           * 全部空なら
           * 非診療日として除外
           */

          const hasValue =
            row.patients ||
            row.insurance ||
            row.care;

          if (hasValue) {
            allRows.push(row);
          }
        }
      }

      /*
       * ======================================
       * 同じ日付を合算
       *
       * 大宮＋城東など複数画像を
       * 1か月分として統合
       * ======================================
       */

      const mergedMap =
        {};

      for (
        const row of
        allRows
      ) {
        if (
          !mergedMap[
            row.day
          ]
        ) {
          mergedMap[
            row.day
          ] = {
            day:
              row.day,

            patients:
              0,

            insurance:
              0,

            care:
              0,

            warnings: {
              patients:
                false,

              insurance:
                false,

              care:
                false,
            },

            sourceCount:
              0,
          };
        }

        const target =
          mergedMap[
            row.day
          ];

        const p =
          Number(
            row.patients
          ) || 0;

        const i =
          Number(
            row.insurance
          ) || 0;

        const c =
          Number(
            row.care
          ) || 0;

        target.patients +=
          p;

        target.insurance +=
          i;

        target.care +=
          c;

        target.warnings
          .patients ||= 
          row.warnings
            .patients;

        target.warnings
          .insurance ||= 
          row.warnings
            .insurance;

        target.warnings
          .care ||= 
          row.warnings
            .care;

        target.sourceCount++;
      }

      const mergedRows =
        Object.values(
          mergedMap
        )
          .sort(
            (a, b) =>
              a.day -
              b.day
          )
          .map((row) => ({
            ...row,

            patients:
              row.patients
                ? String(
                    row.patients
                  )
                : "",

            insurance:
              row.insurance
                ? String(
                    row.insurance
                  )
                : "",

            care:
              row.care
                ? String(
                    row.care
                  )
                : "",
          }));

      const finished =
        performance.now();

      setResults(
        mergedRows
      );

      setElapsed(
        (
          (
            finished -
            started
          ) /
          1000
        ).toFixed(1)
      );

      setStatusText(
        "解析が完了しました"
      );

      setProgress(100);
    } catch (e) {
      console.error(e);

      setError(
        e?.message ||
        "OCR解析中にエラーが発生しました。"
      );

      setStatusText("");
    } finally {
      if (worker) {
        await worker.terminate();
      }

      setIsAnalyzing(false);
    }
  }

  /*
   * ==========================================
   * 手動修正
   * ==========================================
   */

  function updateCell(
    index,
    key,
    value
  ) {
    const cleaned =
      value.replace(
        /\D/g,
        ""
      );

    setResults(
      (current) =>
        current.map(
          (row, i) => {
            if (
              i !== index
            ) {
              return row;
            }

            return {
              ...row,

              [key]:
                cleaned,

              warnings: {
                ...row.warnings,

                /*
                 * 人が修正したので
                 * 警告解除
                 */
                [key]:
                  false,
              },
            };
          }
        )
    );
  }

  /*
   * ==========================================
   * 合計
   * ==========================================
   */

  const totals =
    useMemo(() => {
      return results.reduce(
        (acc, row) => {
          acc.patients +=
            Number(
              row.patients
            ) || 0;

          acc.insurance +=
            Number(
              row.insurance
            ) || 0;

          acc.care +=
            Number(
              row.care
            ) || 0;

          return acc;
        },
        {
          patients: 0,
          insurance: 0,
          care: 0,
        }
      );
    }, [results]);

  const totalPoints =
    totals.insurance +
    totals.care;

  const warningCount =
    useMemo(() => {
      let count = 0;

      for (
        const row of
        results
      ) {
        for (
          const key of [
            "patients",
            "insurance",
            "care",
          ]
        ) {
          if (
            row.warnings[
              key
            ]
          ) {
            count++;
          }
        }
      }

      return count;
    }, [results]);

  /*
   * ==========================================
   * Excel出力
   * ==========================================
   */

  function exportExcel() {
    if (!results.length) {
      return;
    }

    const data =
      results.map(
        (row) => ({
          日付:
            `${row.day}日`,

          実患者:
            Number(
              row.patients
            ) || 0,

          保険診療分:
            Number(
              row.insurance
            ) || 0,

          介護保険:
            Number(
              row.care
            ) || 0,

          合計:
            (
              Number(
                row.insurance
              ) || 0
            ) +
            (
              Number(
                row.care
              ) || 0
            ),
        })
      );

    data.push({
      日付:
        "合計",

      実患者:
        totals.patients,

      保険診療分:
        totals.insurance,

      介護保険:
        totals.care,

      合計:
        totalPoints,
    });

    const worksheet =
      XLSX.utils.json_to_sheet(
        data
      );

    worksheet["!cols"] = [
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
    ];

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "診療日別集計"
    );

    XLSX.writeFile(
      workbook,
      "診療日別集計.xlsx"
    );
  }

  function formatNumber(
    value
  ) {
    if (
      value === "" ||
      value === null ||
      value === undefined
    ) {
      return "";
    }

    const n =
      Number(value);

    return Number.isFinite(n)
      ? n.toLocaleString(
          "ja-JP"
        )
      : value;
  }

  return (
    <main className="page">
      <section className="app">

        <header>
          <div className="logo">
            歯
          </div>

          <div>
            <h1>
              訪問診療OCR
            </h1>

            <p>
              診療日別集計表 → Excel
            </p>
          </div>
        </header>

        <div className="privacy">
          🔒 OCR処理は端末内で行われ、
          画像は外部サーバーへ送信されません
        </div>

        <section className="card">

          <span className="step">
            STEP 1
          </span>

          <h2>
            集計画像を選択
          </h2>

          <p className="description">
            大宮・城東など、
            同じ月の画像を複数選択できます。
          </p>

          <input
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            multiple
            onChange={
              handleFiles
            }
          />

          <button
            className="select-button"
            disabled={
              isAnalyzing
            }
            onClick={() =>
              inputRef
                .current
                ?.click()
            }
          >
            ＋ 画像を選択
          </button>

          {files.length >
            0 && (
            <div className="selected">
              <strong>
                {
                  files.length
                }
                枚選択
              </strong>

              {files.map(
                (
                  file,
                  index
                ) => (
                  <div
                    key={
                      index
                    }
                    style={{
                      marginTop:
                        "5px",
                      fontSize:
                        "12px",
                    }}
                  >
                    {
                      file.name
                    }
                  </div>
                )
              )}
            </div>
          )}

        </section>

        <section className="card">

          <span className="step">
            STEP 2
          </span>

          <h2>
            OCR解析
          </h2>

          <p className="description">
            同じセルを複数の画像処理条件で読み、
            結果が一致しない場所を
            「要確認」として表示します。
          </p>

          <button
            className={
              files.length
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              !files.length ||
              isAnalyzing
            }
            onClick={
              analyzeImages
            }
          >
            {isAnalyzing
              ? "解析中…"
              : "画像を解析"}
          </button>

          {statusText && (
            <div className="ocr-status">

              <p>
                {
                  statusText
                }
              </p>

              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{
                    width:
                      `${progress}%`,
                  }}
                />
              </div>

              <div
                style={{
                  marginTop:
                    "5px",
                  fontSize:
                    "12px",
                  textAlign:
                    "right",
                }}
              >
                {progress}%
              </div>

            </div>
          )}

          {elapsed && (
            <div className="selected">
              解析時間：
              <strong>
                {elapsed}
                秒
              </strong>
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

        </section>

        {results.length >
          0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              読み取り結果を確認
            </h2>

            <p className="description">
              黄色の欄はOCR結果に
              自信がない場所です。
              数字をタップして修正してください。
            </p>

            {warningCount >
              0 ? (
              <div
                style={{
                  background:
                    "#fff7d6",
                  border:
                    "1px solid #facc15",
                  borderRadius:
                    "10px",
                  padding:
                    "12px",
                  marginBottom:
                    "16px",
                  fontWeight:
                    700,
                }}
              >
                ⚠️ 要確認：
                {warningCount}
                箇所
              </div>
            ) : (
              <div
                style={{
                  background:
                    "#ecfdf5",
                  border:
                    "1px solid #86efac",
                  borderRadius:
                    "10px",
                  padding:
                    "12px",
                  marginBottom:
                    "16px",
                  fontWeight:
                    700,
                }}
              >
                ✓ 要確認箇所はありません
              </div>
            )}

            <div
              style={{
                overflowX:
                  "auto",
              }}
            >
              <table
                style={{
                  width:
                    "100%",
                  borderCollapse:
                    "collapse",
                  fontSize:
                    "13px",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={
                        thStyle
                      }
                    >
                      日
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      実患者
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      保険
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      介護
                    </th>

                    <th
                      style={
                        thStyle
                      }
                    >
                      合計
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {results.map(
                    (
                      row,
                      index
                    ) => (
                      <tr
                        key={
                          row.day
                        }
                      >
                        <td
                          style={
                            tdStyle
                          }
                        >
                          <strong>
                            {
                              row.day
                            }
                          </strong>
                        </td>

                        {[
                          "patients",
                          "insurance",
                          "care",
                        ].map(
                          (
                            key
                          ) => (
                            <td
                              key={
                                key
                              }
                              style={{
                                ...tdStyle,

                                background:
                                  row
                                    .warnings[
                                    key
                                  ]
                                    ? "#fff7cc"
                                    : "#fff",
                              }}
                            >
                              <input
                                type="text"
                                inputMode="numeric"
                                value={
                                  row[
                                    key
                                  ]
                                }
                                onChange={
                                  (
                                    e
                                  ) =>
                                    updateCell(
                                      index,
                                      key,
                                      e
                                        .target
                                        .value
                                    )
                                }
                                style={{
                                  width:
                                    "72px",
                                  maxWidth:
                                    "100%",
                                  border:
                                    row
                                      .warnings[
                                      key
                                    ]
                                      ? "2px solid #f59e0b"
                                      : "1px solid #cbd5e1",
                                  borderRadius:
                                    "6px",
                                  padding:
                                    "7px 4px",
                                  textAlign:
                                    "right",
                                  fontSize:
                                    "14px",
                                  background:
                                    row
                                      .warnings[
                                      key
                                    ]
                                      ? "#fffbea"
                                      : "#fff",
                                }}
                              />
                            </td>
                          )
                        )}

                        <td
                          style={{
                            ...tdStyle,
                            textAlign:
                              "right",
                            fontWeight:
                              700,
                          }}
                        >
                          {formatNumber(
                            (
                              Number(
                                row.insurance
                              ) || 0
                            ) +
                            (
                              Number(
                                row.care
                              ) || 0
                            )
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>

                <tfoot>
                  <tr>
                    <td
                      style={
                        totalStyle
                      }
                    >
                      合計
                    </td>

                    <td
                      style={
                        totalStyle
                      }
                    >
                      {formatNumber(
                        totals.patients
                      )}
                    </td>

                    <td
                      style={
                        totalStyle
                      }
                    >
                      {formatNumber(
                        totals.insurance
                      )}
                    </td>

                    <td
                      style={
                        totalStyle
                      }
                    >
                      {formatNumber(
                        totals.care
                      )}
                    </td>

                    <td
                      style={
                        totalStyle
                      }
                    >
                      {formatNumber(
                        totalPoints
                      )}
                    </td>
                  </tr>
                </tfoot>

              </table>
            </div>

            <button
              className="select-button"
              style={{
                marginTop:
                  "20px",
              }}
              onClick={
                exportExcel
              }
            >
              Excelを作成
            </button>

          </section>
        )}

        <footer>
          半自動OCRテスト版
        </footer>

      </section>
    </main>
  );
}

const thStyle = {
  border:
    "1px solid #dbe3ea",
  padding:
    "8px 5px",
  background:
    "#eef6ff",
  textAlign:
    "center",
  whiteSpace:
    "nowrap",
};

const tdStyle = {
  border:
    "1px solid #e2e8f0",
  padding:
    "5px",
  textAlign:
    "center",
};

const totalStyle = {
  border:
    "1px solid #cbd5e1",
  padding:
    "9px 5px",
  background:
    "#eef6ff",
  textAlign:
    "right",
  fontWeight:
    700,
};