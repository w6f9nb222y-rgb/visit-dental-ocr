import { useMemo, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

export default function App() {
  const [files, setFiles] = useState([]);
  const [images, setImages] = useState([]);

  /*
   * 画像ごとの選択日
   *
   * {
   *   0: [7,12,14,...],
   *   1: [6,10,11,...]
   * }
   */
  const [selectedDays, setSelectedDays] =
    useState({});

  const [results, setResults] =
    useState([]);

  const [isAnalyzing, setIsAnalyzing] =
    useState(false);

  const [statusText, setStatusText] =
    useState("");

  const [progress, setProgress] =
    useState(0);

  const [elapsed, setElapsed] =
    useState(null);

  const [error, setError] =
    useState("");

  const inputRef = useRef(null);

  /*
   * ==========================================
   * 現在の帳票位置
   *
   * 大宮画像で調整済み
   * ==========================================
   */

  const ROW_1_CENTER = 0.0545;
  const ROW_31_CENTER = 0.8380;

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
   * 画像選択
   * ==========================================
   */

  async function handleFiles(event) {
    const selected =
      Array.from(
        event.target.files || []
      );

    if (!selected.length) {
      return;
    }

    setFiles(selected);
    setResults([]);
    setSelectedDays({});
    setError("");
    setProgress(0);
    setElapsed(null);
    setStatusText("");

    try {
      const loaded = [];

      for (const file of selected) {
        loaded.push(
          await loadImage(file)
        );
      }

      setImages(loaded);

      /*
       * 各画像の初期選択日は空
       */
      const initial = {};

      selected.forEach(
        (_, index) => {
          initial[index] = [];
        }
      );

      setSelectedDays(initial);
    } catch (e) {
      console.error(e);

      setError(
        "画像の読み込みに失敗しました"
      );
    }
  }

  function loadImage(file) {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        const url =
          URL.createObjectURL(file);

        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };

        image.onerror = () => {
          URL.revokeObjectURL(url);

          reject(
            new Error(
              "画像を読み込めませんでした"
            )
          );
        };

        image.src = url;
      }
    );
  }

  /*
   * ==========================================
   * 日付選択
   * ==========================================
   */

  function toggleDay(
    fileIndex,
    day
  ) {
    setSelectedDays(
      (current) => {
        const days =
          current[fileIndex] || [];

        const exists =
          days.includes(day);

        const nextDays =
          exists
            ? days.filter(
                (d) => d !== day
              )
            : [
                ...days,
                day,
              ].sort(
                (a, b) =>
                  a - b
              );

        return {
          ...current,

          [fileIndex]:
            nextDays,
        };
      }
    );
  }

  function clearDays(
    fileIndex
  ) {
    setSelectedDays(
      (current) => ({
        ...current,

        [fileIndex]: [],
      })
    );
  }

  /*
   * 曜日指定の補助ボタン
   *
   * 年月判定前なので、
   * 今は単純な日付ボタンだけを使う。
   * 後で曜日自動選択を追加できる。
   */

  /*
   * ==========================================
   * 行中心
   * ==========================================
   */

  function getRowCenter(day) {
    const t =
      (day - 1) / 30;

    return (
      ROW_1_CENTER +
      (
        ROW_31_CENTER -
        ROW_1_CENTER
      ) *
        t
    );
  }

  /*
   * ==========================================
   * セル切り抜き
   * ==========================================
   */

  function makeRawCell(
    image,
    day,
    key
  ) {
    const column =
      COLUMNS[key];

    const rowStep =
      (
        ROW_31_CENTER -
        ROW_1_CENTER
      ) / 30;

    const centerY =
      image.height *
      getRowCenter(day);

    /*
     * 数字を中心に、
     * 上下罫線をなるべく除外
     */
    let heightRatio = 0.62;

    /*
     * 31日は下罫線が近いため
     */
    if (day === 31) {
      heightRatio = 0.48;
    }

    const sourceHeight =
      image.height *
      rowStep *
      heightRatio;

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
      document.createElement(
        "canvas"
      );

    canvas.width =
      Math.max(
        50,
        Math.round(
          sourceWidth
        )
      );

    canvas.height =
      Math.max(
        22,
        Math.round(
          sourceHeight
        )
      );

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      "high";

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

  function grayscale(
    source
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      source.width;

    canvas.height =
      source.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.drawImage(
      source,
      0,
      0
    );

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
   * モアレ低減
   * ==========================================
   */

  function reduceMoire(
    source,
    factor
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      Math.max(
        28,
        Math.round(
          source.width *
          factor
        )
      );

    canvas.height =
      Math.max(
        15,
        Math.round(
          source.height *
          factor
        )
      );

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      "high";

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
   * コントラスト
   * ==========================================
   */

  function increaseContrast(
    source,
    amount
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      source.width;

    canvas.height =
      source.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.drawImage(
      source,
      0,
      0
    );

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
      let value =
        data[i];

      value =
        (
          value -
          128
        ) *
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
   * 2値化
   * ==========================================
   */

  function threshold(
    source,
    value
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      source.width;

    canvas.height =
      source.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.drawImage(
      source,
      0,
      0
    );

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
      const v =
        data[i] <
        value
          ? 0
          : 255;

      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
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
   * 拡大
   * ==========================================
   */

  function upscale(
    source,
    scale = 3
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

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

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      "high";

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
   * Canvas → Blob
   * ==========================================
   */

  function canvasToBlob(
    canvas
  ) {
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
   * OCR文字整理
   * ==========================================
   */

  function cleanOCR(
    text,
    key
  ) {
    let value =
      String(text || "")
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/\D/g, "");

    const maxDigits =
      COLUMNS[key]
        .maxDigits;

    if (
      value.length >
      maxDigits
    ) {
      value =
        value.slice(
          -maxDigits
        );
    }

    return value;
  }

  /*
   * ==========================================
   * Tesseract 1回
   * ==========================================
   */

  async function recognizeVariant(
    worker,
    canvas,
    key
  ) {
    const blob =
      await canvasToBlob(
        canvas
      );

    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789,",

      /*
       * 1行の数字として認識
       */
      tessedit_pageseg_mode:
        "7",

      user_defined_dpi:
        "300",
    });

    const result =
      await worker.recognize(
        blob
      );

    return {
      value:
        cleanOCR(
          result.data.text,
          key
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
   * セルOCR
   *
   * 3パターンで読み、多数決
   * ==========================================
   */

  async function recognizeCell(
    worker,
    image,
    day,
    key
  ) {
    const raw =
      makeRawCell(
        image,
        day,
        key
      );

    const gray =
      grayscale(raw);

    const reduced1 =
      reduceMoire(
        gray,
        0.72
      );

    const reduced2 =
      reduceMoire(
        gray,
        0.64
      );

    const variants = [
      /*
       * パターン1
       * コントラスト
       */
      upscale(
        increaseContrast(
          reduced1,
          1.55
        ),
        3
      ),

      /*
       * パターン2
       * 2値化弱め
       */
      upscale(
        threshold(
          reduced2,
          160
        ),
        3
      ),

      /*
       * パターン3
       * 2値化強め
       */
      upscale(
        threshold(
          reduced1,
          180
        ),
        3
      ),
    ];

    const attempts = [];

    for (
      const variant of
      variants
    ) {
      attempts.push(
        await recognizeVariant(
          worker,
          variant,
          key
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

    const value =
      sorted[0]?.[0] || "";

    const agreement =
      sorted[0]?.[1] || 0;

    /*
     * ======================================
     * 要確認判定
     * ======================================
     */

    let warning = false;

    /*
     * 空欄
     */
    if (!value) {
      warning = true;
    }

    /*
     * 3回中2回以上一致しない
     */
    if (
      value &&
      agreement < 2
    ) {
      warning = true;
    }

    const number =
      Number(value);

    /*
     * 実患者
     */
    if (
      key === "patients" &&
      (
        !value ||
        number < 1 ||
        number > 60
      )
    ) {
      warning = true;
    }

    /*
     * 点数
     */
    if (
      key !== "patients" &&
      (
        !value ||
        number < 100
      )
    ) {
      warning = true;
    }

    return {
      value,

      warning,

      agreement,

      attempts:
        attempts.map(
          (item) =>
            item.value ||
            "空"
        ),

      /*
       * 人間確認用なので
       * OCR前処理画像ではなく
       * 元の切り抜きを表示
       */
      preview:
        raw.toDataURL(
          "image/jpeg",
          0.95
        ),
    };
  }

  /*
   * ==========================================
   * 選択日をOCR
   * ==========================================
   */

  async function analyzeSelectedDays() {
    if (
      !images.length ||
      isAnalyzing
    ) {
      return;
    }

    const totalDays =
      Object.values(
        selectedDays
      ).reduce(
        (sum, days) =>
          sum +
          days.length,
        0
      );

    if (!totalDays) {
      setError(
        "診療日を選択してください"
      );

      return;
    }

    setResults([]);
    setError("");
    setElapsed(null);
    setProgress(0);
    setIsAnalyzing(true);

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

      const output = [];

      const totalCells =
        totalDays * 3;

      let completed = 0;

      for (
        let fileIndex = 0;
        fileIndex <
        images.length;
        fileIndex++
      ) {
        const image =
          images[fileIndex];

        const days =
          selectedDays[
            fileIndex
          ] || [];

        for (
          const day of days
        ) {
          const row = {
            id:
              `${fileIndex}-${day}`,

            fileIndex,

            fileName:
              files[
                fileIndex
              ]?.name || "",

            day,

            patients: "",
            insurance: "",
            care: "",

            warnings: {
              patients:
                false,

              insurance:
                false,

              care:
                false,
            },

            previews: {},

            attempts: {},
          };

          for (
            const key of [
              "patients",
              "insurance",
              "care",
            ]
          ) {
            setStatusText(
              `${fileIndex + 1}/${images.length}枚目　${day}日 ${COLUMNS[key].label} を解析中…`
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

            row.previews[
              key
            ] =
              result.preview;

            row.attempts[
              key
            ] =
              result.attempts;

            completed++;

            setProgress(
              Math.round(
                (
                  completed /
                  totalCells
                ) *
                  100
              )
            );
          }

          output.push(row);
        }
      }

      /*
       * 日付順
       */
      output.sort(
        (a, b) => {
          if (
            a.day !== b.day
          ) {
            return (
              a.day -
              b.day
            );
          }

          return (
            a.fileIndex -
            b.fileIndex
          );
        }
      );

      setResults(output);

      setElapsed(
        (
          (
            performance.now() -
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
        "OCR解析中にエラーが発生しました"
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
   * 手修正
   * ==========================================
   */

  function updateCell(
    rowIndex,
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
          (row, index) => {
            if (
              index !==
              rowIndex
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
                 * 人が入力したら
                 * 要確認解除
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
   * 要確認数
   * ==========================================
   */

  const warningCount =
    useMemo(() => {
      let count = 0;

      for (
        const row of results
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
   * 日付ごとに集約
   *
   * 複数画像で同じ日があれば
   * 合算する
   * ==========================================
   */

  const mergedRows =
    useMemo(() => {
      const map = {};

      for (
        const row of
        results
      ) {
        if (!map[row.day]) {
          map[row.day] = {
            day:
              row.day,

            patients: 0,

            insurance: 0,

            care: 0,
          };
        }

        map[
          row.day
        ].patients +=
          Number(
            row.patients
          ) || 0;

        map[
          row.day
        ].insurance +=
          Number(
            row.insurance
          ) || 0;

        map[
          row.day
        ].care +=
          Number(
            row.care
          ) || 0;
      }

      return Object.values(
        map
      ).sort(
        (a, b) =>
          a.day -
          b.day
      );
    }, [results]);

  /*
   * ==========================================
   * 合計
   * ==========================================
   */

  const totals =
    useMemo(() => {
      return mergedRows.reduce(
        (acc, row) => {
          acc.patients +=
            row.patients;

          acc.insurance +=
            row.insurance;

          acc.care +=
            row.care;

          return acc;
        },
        {
          patients: 0,
          insurance: 0,
          care: 0,
        }
      );
    }, [mergedRows]);

  const totalPoints =
    totals.insurance +
    totals.care;

  /*
   * ==========================================
   * Excel
   * ==========================================
   */

  function exportExcel() {
    if (!mergedRows.length) {
      return;
    }

    const data =
      mergedRows.map(
        (row) => ({
          日付:
            `${row.day}日`,

          実患者:
            row.patients,

          保険診療分:
            row.insurance,

          介護保険:
            row.care,

          合計:
            row.insurance +
            row.care,
        })
      );

    /*
     * 合計行
     */

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

  /*
   * ==========================================
   * 表示
   * ==========================================
   */

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
          🔒 画像・OCR処理は端末内で行われ、
          外部サーバーへ送信されません
        </div>

        {/* ==============================
            STEP 1
        ============================== */}

        <section className="card">

          <span className="step">
            STEP 1
          </span>

          <h2>
            集計画像を選択
          </h2>

          <p className="description">
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
              inputRef.current?.click()
            }
          >
            ＋画像を選択
          </button>

          {files.length > 0 && (
            <div className="selected">

              <strong>
                {files.length}
                枚選択
              </strong>

              {files.map(
                (
                  file,
                  index
                ) => (
                  <div
                    key={index}
                    style={{
                      marginTop:
                        "5px",

                      fontSize:
                        "12px",
                    }}
                  >
                    {file.name}
                  </div>
                )
              )}

            </div>
          )}

        </section>

        {/* ==============================
            STEP 2
        ============================== */}

        {images.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 2
            </span>

            <h2>
              診療日を選択
            </h2>

            <p className="description">
              各画像について、
              診療した日をタップしてください。
              青色が選択中です。
            </p>

            {files.map(
              (
                file,
                fileIndex
              ) => {

                const days =
                  selectedDays[
                    fileIndex
                  ] || [];

                return (
                  <div
                    key={
                      fileIndex
                    }
                    style={{
                      marginTop:
                        fileIndex
                          ? "32px"
                          : "15px",
                    }}
                  >

                    <div
                      style={{
                        display:
                          "flex",

                        justifyContent:
                          "space-between",

                        alignItems:
                          "center",

                        gap:
                          "10px",

                        marginBottom:
                          "10px",
                      }}
                    >

                      <strong
                        style={{
                          fontSize:
                            "14px",
                        }}
                      >
                        {file.name}
                      </strong>

                      <button
                        onClick={() =>
                          clearDays(
                            fileIndex
                          )
                        }
                        style={
                          miniButton
                        }
                      >
                        クリア
                      </button>

                    </div>

                    <div
                      style={{
                        marginBottom:
                          "10px",

                        fontSize:
                          "12px",

                        color:
                          "#64748b",
                      }}
                    >
                      選択：
                      {days.length}
                      日
                      {days.length
                        ? `（${days.join("・")}）`
                        : ""}
                    </div>

                    <div
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "repeat(7, 1fr)",

                        gap:
                          "6px",
                      }}
                    >

                      {Array.from(
                        {
                          length:
                            31,
                        },

                        (
                          _,
                          i
                        ) =>
                          i + 1
                      ).map(
                        (day) => {

                          const selected =
                            days.includes(
                              day
                            );

                          return (
                            <button
                              key={
                                day
                              }
                              onClick={() =>
                                toggleDay(
                                  fileIndex,
                                  day
                                )
                              }
                              style={{
                                border:
                                  selected
                                    ? "2px solid #2563eb"
                                    : "1px solid #cbd5e1",

                                background:
                                  selected
                                    ? "#dbeafe"
                                    : "#fff",

                                color:
                                  selected
                                    ? "#1d4ed8"
                                    : "#334155",

                                borderRadius:
                                  "9px",

                                padding:
                                  "9px 2px",

                                fontSize:
                                  "15px",

                                fontWeight:
                                  selected
                                    ? 700
                                    : 400,
                              }}
                            >
                              {day}
                            </button>
                          );
                        }
                      )}

                    </div>

                  </div>
                );
              }
            )}

          </section>
        )}

        {/* ==============================
            STEP 3
        ============================== */}

        {images.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              選択日をOCR
            </h2>

            <p className="description">
              選択した診療日だけを読み取ります。
            </p>

            <button
              className="select-button"
              disabled={
                isAnalyzing
              }
              onClick={
                analyzeSelectedDays
              }
            >
              {isAnalyzing
                ? "解析中…"
                : "選択した日を解析"}
            </button>

            {statusText && (
              <div className="ocr-status">

                <p>
                  {statusText}
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

                    textAlign:
                      "right",

                    fontSize:
                      "12px",
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
        )}

        {/* ==============================
            STEP 4
        ============================== */}

        {results.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 4
            </span>

            <h2>
              読み取り結果を確認
            </h2>

            <p className="description">
              黄色の項目は要確認です。
              元画像の数字を見ながら修正してください。
            </p>

            <div
              style={{
                padding:
                  "12px",

                borderRadius:
                  "10px",

                marginBottom:
                  "18px",

                fontWeight:
                  700,

                background:
                  warningCount
                    ? "#fff7d6"
                    : "#ecfdf5",

                border:
                  warningCount
                    ? "1px solid #facc15"
                    : "1px solid #86efac",
              }}
            >
              {warningCount
                ? `⚠️ 要確認：${warningCount}箇所`
                : "✓ 要確認箇所はありません"}
            </div>

            {results.map(
              (
                row,
                rowIndex
              ) => (
                <div
                  key={
                    row.id
                  }
                  style={{
                    border:
                      "1px solid #dbe3ea",

                    borderRadius:
                      "12px",

                    marginBottom:
                      "18px",

                    overflow:
                      "hidden",
                  }}
                >

                  <div
                    style={{
                      padding:
                        "10px 12px",

                      background:
                        "#eef6ff",
                    }}
                  >

                    <strong
                      style={{
                        fontSize:
                          "18px",
                      }}
                    >
                      {row.day}日
                    </strong>

                    <div
                      style={{
                        fontSize:
                          "10px",

                        color:
                          "#64748b",

                        marginTop:
                          "2px",
                      }}
                    >
                      {row.fileName}
                    </div>

                  </div>

                  {[
                    "patients",
                    "insurance",
                    "care",
                  ].map(
                    (key) => {

                      const warning =
                        row
                          .warnings[
                          key
                        ];

                      return (
                        <div
                          key={
                            key
                          }
                          style={{
                            padding:
                              "12px",

                            borderTop:
                              "1px solid #e2e8f0",

                            background:
                              warning
                                ? "#fffbea"
                                : "#fff",
                          }}
                        >

                          <div
                            style={{
                              fontSize:
                                "12px",

                              fontWeight:
                                700,

                              marginBottom:
                                "7px",
                            }}
                          >
                            {
                              COLUMNS[
                                key
                              ].label
                            }

                            {warning &&
                              " ⚠️ 要確認"}
                          </div>

                          {/* 元画像 */}

                          <div
                            style={{
                              background:
                                "#fff",

                              border:
                                "1px solid #dbe3ea",

                              borderRadius:
                                "7px",

                              overflow:
                                "hidden",

                              padding:
                                "4px",
                            }}
                          >

                            <img
                              src={
                                row
                                  .previews[
                                  key
                                ]
                              }
                              alt=""
                              style={{
                                width:
                                  "100%",

                                height:
                                  "60px",

                                objectFit:
                                  "contain",

                                display:
                                  "block",
                              }}
                            />

                          </div>

                          {/* 修正欄 */}

                          <input
                            type="text"
                            inputMode="numeric"
                            value={
                              row[key]
                            }
                            placeholder="数字を入力"
                            onChange={
                              (e) =>
                                updateCell(
                                  rowIndex,
                                  key,
                                  e
                                    .target
                                    .value
                                )
                            }
                            style={{
                              width:
                                "100%",

                              boxSizing:
                                "border-box",

                              marginTop:
                                "8px",

                              padding:
                                "10px",

                              fontSize:
                                "20px",

                              textAlign:
                                "right",

                              border:
                                warning
                                  ? "2px solid #f59e0b"
                                  : "1px solid #cbd5e1",

                              borderRadius:
                                "8px",

                              background:
                                "#fff",
                            }}
                          />

                          <div
                            style={{
                              fontSize:
                                "10px",

                              color:
                                "#64748b",

                              marginTop:
                                "5px",
                            }}
                          >
                            OCR候補：
                            {
                              row
                                .attempts[
                                key
                              ].join(
                                " / "
                              )
                            }
                          </div>

                        </div>
                      );
                    }
                  )}

                </div>
              )
            )}

          </section>
        )}

        {/* ==============================
            STEP 5
        ============================== */}

        {results.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 5
            </span>

            <h2>
              集計
            </h2>

            <div
              style={{
                background:
                  "#eef6ff",

                padding:
                  "14px",

                borderRadius:
                  "10px",

                lineHeight:
                  "1.9",
              }}
            >

              <div>
                出勤日数：
                <strong>
                  {
                    mergedRows.length
                  }
                  日
                </strong>
              </div>

              <div>
                実患者：
                <strong>
                  {
                    totals.patients
                  }
                  人
                </strong>
              </div>

              <div>
                保険診療分：
                <strong>
                  {totals.insurance.toLocaleString()}
                </strong>
              </div>

              <div>
                介護保険：
                <strong>
                  {totals.care.toLocaleString()}
                </strong>
              </div>

              <div
                style={{
                  marginTop:
                    "5px",

                  fontSize:
                    "18px",
                }}
              >
                合計：
                <strong>
                  {totalPoints.toLocaleString()}
                </strong>
              </div>

            </div>

            <button
              className="select-button"
              style={{
                marginTop:
                  "18px",
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
          半自動OCR 実用テスト版
        </footer>

      </section>

    </main>
  );
}

const miniButton = {
  border:
    "1px solid #cbd5e1",

  background:
    "#fff",

  borderRadius:
    "7px",

  padding:
    "6px 10px",

  fontSize:
    "11px",

  whiteSpace:
    "nowrap",
};