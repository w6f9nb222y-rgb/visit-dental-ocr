import { useMemo, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

export default function App() {
  const [files, setFiles] = useState([]);
  const [images, setImages] = useState([]);

  const [isDetecting, setIsDetecting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  /*
   * 画像ごとの診療日候補
   *
   * {
   *   fileIndex: {
   *     days: [7,14,21,28],
   *     scores: {...}
   *   }
   * }
   */
  const [detected, setDetected] = useState({});

  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(null);

  const inputRef = useRef(null);

  /*
   * =====================================
   * 現在合わせてある帳票座標
   * =====================================
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
   * =====================================
   * ファイル選択
   * =====================================
   */

  async function handleFiles(event) {
    const selected = Array.from(
      event.target.files || []
    );

    if (!selected.length) return;

    setFiles(selected);
    setDetected({});
    setResults([]);
    setError("");
    setProgress(0);
    setStatusText("");
    setElapsed(null);

    try {
      const loaded = [];

      for (const file of selected) {
        loaded.push(
          await loadImage(file)
        );
      }

      setImages(loaded);
    } catch (e) {
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
          URL.createObjectURL(
            file
          );

        image.onload = () => {
          URL.revokeObjectURL(
            url
          );

          resolve(image);
        };

        image.onerror = () => {
          URL.revokeObjectURL(
            url
          );

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
   * =====================================
   * セル切り抜き
   * =====================================
   */

  function makeRawCell(
    image,
    day,
    columnKey,
    heightRatio = 0.68
  ) {
    const column =
      COLUMNS[columnKey];

    const centerY =
      image.height *
      (
        ROW_1_CENTER +
        (day - 1) *
          ROW_STEP
      );

    const sourceHeight =
      image.height *
      ROW_STEP *
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
        40,
        Math.round(
          sourceWidth
        )
      );

    canvas.height =
      Math.max(
        20,
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
   * =====================================
   * グレースケール
   * =====================================
   */

  function grayscale(source) {
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
   * =====================================
   * 軽いモアレ低減
   * =====================================
   */

  function reduceMoire(
    source,
    factor = 0.68
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      Math.max(
        24,
        Math.round(
          source.width *
            factor
        )
      );

    canvas.height =
      Math.max(
        14,
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
   * =====================================
   * 文字量スコア
   *
   * 単独の「0」と
   * 2桁～5桁の数字を
   * OCRせずに大まかに判定する
   * =====================================
   */

  function getInkScore(
    source
  ) {
    const gray =
      grayscale(
        reduceMoire(
          source,
          0.65
        )
      );

    const ctx =
      gray.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    const {
      width,
      height,
    } = gray;

    const data =
      ctx.getImageData(
        0,
        0,
        width,
        height
      ).data;

    /*
     * 上下端は罫線があるので除外
     */
    const yStart =
      Math.floor(
        height * 0.18
      );

    const yEnd =
      Math.ceil(
        height * 0.82
      );

    /*
     * 左右端も罫線対策で除外
     */
    const xStart =
      Math.floor(
        width * 0.08
      );

    const xEnd =
      Math.ceil(
        width * 0.92
      );

    let darkCount = 0;
    let total = 0;

    let minX = width;
    let maxX = -1;

    for (
      let y = yStart;
      y < yEnd;
      y++
    ) {
      for (
        let x = xStart;
        x < xEnd;
        x++
      ) {
        const index =
          (y * width + x) *
          4;

        const value =
          data[index];

        total++;

        /*
         * 少し厳しめ
         */
        if (value < 110) {
          darkCount++;

          minX =
            Math.min(
              minX,
              x
            );

          maxX =
            Math.max(
              maxX,
              x
            );
        }
      }
    }

    const density =
      total
        ? darkCount /
          total
        : 0;

    const span =
      maxX >= minX
        ? (
            maxX -
            minX +
            1
          ) /
          Math.max(
            1,
            xEnd -
              xStart
          )
        : 0;

    /*
     * 横幅を重視
     *
     * 「0」は狭い
     * 11,484等は広い
     */
    return (
      density * 0.35 +
      span * 0.65
    );
  }

  /*
   * =====================================
   * 診療日候補検出
   * =====================================
   */

  async function detectDays() {
    if (
      !images.length ||
      isDetecting
    ) {
      return;
    }

    setIsDetecting(true);
    setDetected({});
    setResults([]);
    setError("");
    setProgress(0);

    try {
      const newDetected = {};

      for (
        let fileIndex = 0;
        fileIndex <
        images.length;
        fileIndex++
      ) {
        const image =
          images[fileIndex];

        const dayScores = [];

        for (
          let day = 1;
          day <= 31;
          day++
        ) {
          setStatusText(
            `${fileIndex + 1}/${images.length}枚目：${day}日の数字量を確認中…`
          );

          const p =
            getInkScore(
              makeRawCell(
                image,
                day,
                "patients"
              )
            );

          const i =
            getInkScore(
              makeRawCell(
                image,
                day,
                "insurance"
              )
            );

          const c =
            getInkScore(
              makeRawCell(
                image,
                day,
                "care"
              )
            );

          /*
           * 保険と介護をやや重視
           */
          const score =
            p * 0.25 +
            i * 0.40 +
            c * 0.35;

          dayScores.push({
            day,
            score,
            patients: p,
            insurance: i,
            care: c,
          });

          const done =
            fileIndex * 31 +
            day;

          setProgress(
            Math.round(
              (
                done /
                (
                  images.length *
                  31
                )
              ) *
                100
            )
          );
        }

        /*
         * =================================
         * 自動しきい値
         *
         * 31日の中央値を
         * 「0だけの日」の基準として利用
         * =================================
         */

        const values =
          dayScores
            .map(
              (item) =>
                item.score
            )
            .sort(
              (a, b) =>
                a - b
            );

        const median =
          values[
            Math.floor(
              values.length /
                2
            )
          ];

        const deviations =
          values
            .map(
              (value) =>
                Math.abs(
                  value -
                    median
                )
            )
            .sort(
              (a, b) =>
                a - b
            );

        const mad =
          deviations[
            Math.floor(
              deviations.length /
                2
            )
          ];

        /*
         * 数字量が中央値より
         * 明確に多い行を候補とする
         */
        const threshold =
          median +
          Math.max(
            mad * 2.2,
            0.035
          );

        const days =
          dayScores
            .filter(
              (item) =>
                item.score >
                threshold
            )
            .map(
              (item) =>
                item.day
            );

        newDetected[
          fileIndex
        ] = {
          days,
          scores:
            dayScores,
          median,
          threshold,
        };
      }

      setDetected(
        newDetected
      );

      setStatusText(
        "診療日候補を抽出しました"
      );

      setProgress(100);
    } catch (e) {
      console.error(e);

      setError(
        "診療日候補の検出中にエラーが発生しました"
      );
    } finally {
      setIsDetecting(false);
    }
  }

  /*
   * =====================================
   * 日付を手動ON/OFF
   * =====================================
   */

  function toggleDay(
    fileIndex,
    day
  ) {
    setDetected(
      (current) => {
        const target =
          current[fileIndex];

        if (!target) {
          return current;
        }

        const exists =
          target.days.includes(
            day
          );

        const days =
          exists
            ? target.days.filter(
                (d) =>
                  d !== day
              )
            : [
                ...target.days,
                day,
              ].sort(
                (a, b) =>
                  a - b
              );

        return {
          ...current,

          [fileIndex]: {
            ...target,
            days,
          },
        };
      }
    );
  }

  /*
   * =====================================
   * OCR用前処理
   * =====================================
   */

  function increaseContrast(
    source,
    amount = 1.55
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

      data[i] =
        value;

      data[i + 1] =
        value;

      data[i + 2] =
        value;

      data[i + 3] =
        255;
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

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
        data[i] < value
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
      canvas.getContext(
        "2d"
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

  function cleanOCR(
    text,
    key
  ) {
    let value =
      String(text || "")
        .replace(
          /[Oo]/g,
          "0"
        )
        .replace(
          /[Il|]/g,
          "1"
        )
        .replace(
          /\D/g,
          ""
        );

    const max =
      COLUMNS[key]
        .maxDigits;

    if (
      value.length >
      max
    ) {
      value =
        value.slice(
          -max
        );
    }

    return value;
  }

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
          result.data
            .confidence || 0
        ),
    };
  }

  /*
   * =====================================
   * セルOCR
   * =====================================
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
        key,
        0.72
      );

    const gray =
      grayscale(raw);

    const reduced =
      reduceMoire(
        gray,
        0.70
      );

    const variants = [
      upscale(
        increaseContrast(
          reduced,
          1.45
        ),
        3
      ),

      upscale(
        threshold(
          reduced,
          155
        ),
        3
      ),

      upscale(
        threshold(
          reduced,
          175
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

    const counts = {};

    for (
      const attempt of
      attempts
    ) {
      if (
        !attempt.value
      ) {
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
          b[1] -
          a[1]
      );

    const value =
      sorted[0]?.[0] ||
      "";

    const agreement =
      sorted[0]?.[1] ||
      0;

    let warning =
      agreement < 2;

    /*
     * 常識的範囲チェック
     */

    const n =
      Number(value);

    if (
      key ===
        "patients" &&
      (
        !value ||
        n < 1 ||
        n > 60
      )
    ) {
      warning = true;
    }

    if (
      key !==
        "patients" &&
      (
        !value ||
        n < 100
      )
    ) {
      warning = true;
    }

    return {
      value,
      warning,
      attempts:
        attempts.map(
          (a) =>
            a.value ||
            "空"
        ),

      preview:
        raw.toDataURL(
          "image/jpeg",
          0.9
        ),
    };
  }

  /*
   * =====================================
   * 選択した診療日だけOCR
   * =====================================
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
        detected
      ).reduce(
        (sum, item) =>
          sum +
          item.days.length,
        0
      );

    if (!totalDays) {
      setError(
        "診療日が1日も選択されていません"
      );

      return;
    }

    setIsAnalyzing(true);
    setResults([]);
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

      const rows = [];

      let done = 0;

      const total =
        totalDays * 3;

      for (
        let fileIndex = 0;
        fileIndex <
        images.length;
        fileIndex++
      ) {
        const image =
          images[fileIndex];

        const days =
          detected[
            fileIndex
          ]?.days || [];

        for (
          const day of days
        ) {
          const row = {
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
              `${day}日 ${COLUMNS[key].label} を解析中…`
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

            done++;

            setProgress(
              Math.round(
                (
                  done /
                  total
                ) *
                  100
              )
            );
          }

          rows.push(row);
        }
      }

      rows.sort(
        (a, b) =>
          a.day -
          b.day
      );

      setResults(rows);

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
        "OCR解析が完了しました"
      );

      setProgress(100);
    } catch (e) {
      console.error(e);

      setError(
        "OCR解析中にエラーが発生しました"
      );
    } finally {
      if (worker) {
        await worker.terminate();
      }

      setIsAnalyzing(false);
    }
  }

  /*
   * =====================================
   * 手動修正
   * =====================================
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
          (row, i) =>
            i === index
              ? {
                  ...row,

                  [key]:
                    cleaned,

                  warnings: {
                    ...row.warnings,

                    [key]:
                      false,
                  },
                }
              : row
        )
    );
  }

  /*
   * =====================================
   * 合計
   * =====================================
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

  const warningCount =
    useMemo(() => {
      let count = 0;

      results.forEach(
        (row) => {
          [
            "patients",
            "insurance",
            "care",
          ].forEach(
            (key) => {
              if (
                row.warnings[
                  key
                ]
              ) {
                count++;
              }
            }
          );
        }
      );

      return count;
    }, [results]);

  /*
   * =====================================
   * Excel
   * =====================================
   */

  function exportExcel() {
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

    const worksheet =
      XLSX.utils.json_to_sheet(
        data
      );

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
          🔒 画像処理・OCRは端末内で行われます
        </div>

        {/* STEP 1 */}

        <section className="card">
          <span className="step">
            STEP 1
          </span>

          <h2>
            集計画像を選択
          </h2>

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
            onClick={() =>
              inputRef.current?.click()
            }
          >
            ＋画像を選択
          </button>

          {files.map(
            (file, index) => (
              <div
                className="selected"
                key={index}
              >
                {file.name}
              </div>
            )
          )}
        </section>

        {/* STEP 2 */}

        <section className="card">
          <span className="step">
            STEP 2
          </span>

          <h2>
            診療日を検出
          </h2>

          <p className="description">
            まずOCRを使わず、
            数字量から診療日候補を探します。
          </p>

          <button
            className="select-button"
            disabled={
              !images.length ||
              isDetecting
            }
            onClick={
              detectDays
            }
          >
            {isDetecting
              ? "検出中…"
              : "診療日候補を検出"}
          </button>

          {Object.entries(
            detected
          ).map(
            ([
              fileIndex,
              info,
            ]) => (
              <div
                key={
                  fileIndex
                }
                style={{
                  marginTop:
                    "22px",
                }}
              >
                <strong>
                  {
                    files[
                      Number(
                        fileIndex
                      )
                    ]?.name
                  }
                </strong>

                <p
                  style={{
                    fontSize:
                      "12px",
                    color:
                      "#64748b",
                  }}
                >
                  青＝診療日として選択中
                </p>

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
                        info.days.includes(
                          day
                        );

                      return (
                        <button
                          key={
                            day
                          }
                          onClick={() =>
                            toggleDay(
                              Number(
                                fileIndex
                              ),
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

                            borderRadius:
                              "8px",

                            padding:
                              "8px 2px",

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
            )
          )}
        </section>

        {/* STEP 3 */}

        {Object.keys(
          detected
        ).length >
          0 && (
          <section className="card">
            <span className="step">
              STEP 3
            </span>

            <h2>
              選択した日をOCR
            </h2>

            <p className="description">
              診療日が合っているか確認してから
              OCRを開始してください。
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
                : "選択した診療日を解析"}
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

                <p
                  style={{
                    textAlign:
                      "right",
                    fontSize:
                      "12px",
                  }}
                >
                  {progress}%
                </p>
              </div>
            )}

            {elapsed && (
              <div className="selected">
                解析時間：
                {elapsed}秒
              </div>
            )}

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
          </section>
        )}

        {/* STEP 4 */}

        {results.length >
          0 && (
          <section className="card">
            <span className="step">
              STEP 4
            </span>

            <h2>
              読み取り結果
            </h2>

            <div
              style={{
                background:
                  warningCount
                    ? "#fff7d6"
                    : "#ecfdf5",

                padding:
                  "12px",

                borderRadius:
                  "10px",

                marginBottom:
                  "18px",

                fontWeight:
                  700,
              }}
            >
              {warningCount
                ? `⚠️ 要確認：${warningCount}箇所`
                : "✓ 要確認箇所なし"}
            </div>

            {results.map(
              (
                row,
                index
              ) => (
                <div
                  key={`${row.fileIndex}-${row.day}`}
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

                      fontWeight:
                        700,
                    }}
                  >
                    {row.day}日
                  </div>

                  {[
                    "patients",
                    "insurance",
                    "care",
                  ].map(
                    (key) => (
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
                            row
                              .warnings[
                              key
                            ]
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
                              "6px",
                          }}
                        >
                          {
                            COLUMNS[
                              key
                            ].label
                          }

                          {row
                            .warnings[
                            key
                          ] &&
                            " ⚠️"}
                        </div>

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
                              "48px",
                            objectFit:
                              "contain",
                            background:
                              "#fff",
                            border:
                              "1px solid #ddd",
                            borderRadius:
                              "6px",
                          }}
                        />

                        <input
                          type="text"
                          inputMode="numeric"
                          value={
                            row[key]
                          }
                          onChange={
                            (e) =>
                              updateCell(
                                index,
                                key,
                                e.target.value
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
                              row
                                .warnings[
                                key
                              ]
                                ? "2px solid #f59e0b"
                                : "1px solid #cbd5e1",
                            borderRadius:
                              "8px",
                          }}
                        />

                        <div
                          style={{
                            fontSize:
                              "11px",
                            color:
                              "#64748b",
                            marginTop:
                              "4px",
                          }}
                        >
                          OCR：
                          {row
                            .attempts[
                            key
                          ].join(
                            " / "
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )
            )}

            <div
              style={{
                background:
                  "#eef6ff",
                padding:
                  "14px",
                borderRadius:
                  "10px",
                marginTop:
                  "18px",
              }}
            >
              <div>
                実患者：
                <strong>
                  {totals.patients}
                </strong>
              </div>

              <div>
                保険：
                <strong>
                  {totals.insurance.toLocaleString()}
                </strong>
              </div>

              <div>
                介護：
                <strong>
                  {totals.care.toLocaleString()}
                </strong>
              </div>

              <div
                style={{
                  marginTop:
                    "6px",
                  fontSize:
                    "18px",
                }}
              >
                総点数：
                <strong>
                  {(
                    totals.insurance +
                    totals.care
                  ).toLocaleString()}
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
          半自動OCR
        </footer>

      </section>
    </main>
  );
}