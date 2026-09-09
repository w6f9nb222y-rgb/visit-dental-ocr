import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [file, setFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(null);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * ----------------------------------------------------
   * 現在ほぼ合っている位置情報
   * ----------------------------------------------------
   */

  const ROW_1_CENTER = 0.0550;
  const ROW_STEP = 0.0267;

  const COLUMNS = {
    patients: {
      label: "実患者",
      x: 0.4820,
      w: 0.0300,
    },

    insurance: {
      label: "保険診療分",
      x: 0.5280,
      w: 0.0700,
    },

    care: {
      label: "介護保険",
      x: 0.7970,
      w: 0.0600,
    },
  };

  const TEST_DAYS = [7, 14, 21, 28];

  function handleFile(event) {
    const selected = event.target.files?.[0];

    if (!selected) return;

    setFile(selected);
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
          new Error("画像を読み込めませんでした")
        );
      };

      image.src = url;
    });
  }

  function clamp(value) {
    return Math.max(0, Math.min(255, value));
  }

  /*
   * ----------------------------------------------------
   * 元セルを切り抜く
   * ----------------------------------------------------
   */

  function makeRawCellCanvas(
    image,
    day,
    columnKey
  ) {
    const column = COLUMNS[columnKey];

    const centerY =
      image.height *
      (
        ROW_1_CENTER +
        (day - 1) * ROW_STEP
      );

    const sourceHeight =
      image.height *
      ROW_STEP *
      0.60;

    let sourceX =
      image.width *
      column.x;

    let sourceWidth =
      image.width *
      column.w;

    const sourceY =
      centerY -
      sourceHeight / 2;

    /*
     * 罫線がなるべく入らないよう
     * 列の左右を少しだけ削る。
     */
    const trim =
      columnKey === "patients"
        ? 0.04
        : 0.035;

    sourceX +=
      sourceWidth * trim;

    sourceWidth *=
      1 - trim * 2;

    const canvas =
      document.createElement("canvas");

    canvas.width =
      Math.max(
        30,
        Math.round(sourceWidth)
      );

    canvas.height =
      Math.max(
        20,
        Math.round(sourceHeight)
      );

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.fillStyle = "#ffffff";

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
   * ----------------------------------------------------
   * モアレ軽減
   *
   * 一度縮小して画面の細かい画素パターンを
   * 平均化してからOCRサイズへ拡大する。
   * ----------------------------------------------------
   */

  function suppressMoire(rawCanvas) {
    /*
     * いったん約45%へ縮小
     */
    const small =
      document.createElement("canvas");

    small.width =
      Math.max(
        20,
        Math.round(
          rawCanvas.width * 0.45
        )
      );

    small.height =
      Math.max(
        16,
        Math.round(
          rawCanvas.height * 0.45
        )
      );

    const smallCtx =
      small.getContext("2d", {
        willReadFrequently: true,
      });

    smallCtx.fillStyle = "#ffffff";

    smallCtx.fillRect(
      0,
      0,
      small.width,
      small.height
    );

    smallCtx.imageSmoothingEnabled = true;
    smallCtx.imageSmoothingQuality = "high";

    smallCtx.drawImage(
      rawCanvas,
      0,
      0,
      small.width,
      small.height
    );

    /*
     * OCR向けに大きく戻す
     */
    const output =
      document.createElement("canvas");

    output.width =
      Math.max(
        300,
        small.width * 7
      );

    output.height =
      Math.max(
        120,
        small.height * 7
      );

    const ctx =
      output.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.fillStyle = "#ffffff";

    ctx.fillRect(
      0,
      0,
      output.width,
      output.height
    );

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      small,
      0,
      0,
      output.width,
      output.height
    );

    return output;
  }

  /*
   * ----------------------------------------------------
   * グレースケール版
   * ----------------------------------------------------
   */

  function makeGrayVariant(rawCanvas) {
    const canvas =
      suppressMoire(rawCanvas);

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data = imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const gray =
        data[i] * 0.299 +
        data[i + 1] * 0.587 +
        data[i + 2] * 0.114;

      /*
       * 前回よりコントラストを弱める。
       * モアレを強調しないため。
       */
      let value =
        (gray - 128) * 1.12 + 128;

      value = clamp(value);

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
   * ----------------------------------------------------
   * 軽い2値化版
   * ----------------------------------------------------
   */

  function makeThresholdVariant(
    rawCanvas,
    threshold
  ) {
    const canvas =
      suppressMoire(rawCanvas);

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

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

      const value =
        gray < threshold
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

  function cleanText(text) {
    return String(text || "")
      .replace(/\s/g, "")
      .replace(/[^\d,]/g, "");
  }

  /*
   * ----------------------------------------------------
   * 候補の妥当性評価
   * ----------------------------------------------------
   *
   * Tesseractのconfidenceだけでは
   * 「1」などの誤認識が高得点になることがある。
   *
   * そこで帳票として自然な数字かも評価する。
   */

  function candidateScore(
    columnKey,
    value,
    confidence
  ) {
    if (!value) {
      return -100;
    }

    const digits =
      value.replace(/,/g, "");

    if (!/^\d+$/.test(digits)) {
      return -100;
    }

    const number =
      Number(digits);

    if (!Number.isFinite(number)) {
      return -100;
    }

    let score =
      Number(confidence || 0);

    if (columnKey === "patients") {
      /*
       * 実患者は通常1〜2桁。
       */
      if (
        number >= 1 &&
        number <= 99
      ) {
        score += 40;
      } else {
        score -= 60;
      }

      if (
        digits.length === 2
      ) {
        score += 10;
      }
    } else {
      /*
       * 保険・介護点数。
       *
       * 今回の勤務日の数字は
       * 基本的に4〜5桁。
       */
      if (
        number >= 1000 &&
        number <= 50000
      ) {
        score += 35;
      }

      if (
        digits.length === 4 ||
        digits.length === 5
      ) {
        score += 20;
      }

      /*
       * 「1」「5」などを誤採用しにくくする。
       */
      if (
        number > 0 &&
        number < 100
      ) {
        score -= 40;
      }
    }

    return score;
  }

  /*
   * ----------------------------------------------------
   * 1つの画像をOCR
   * ----------------------------------------------------
   */

  async function recognizeVariant(
    worker,
    canvas,
    columnKey,
    variantName
  ) {
    const blob =
      await canvasToBlob(canvas);

    await worker.setParameters({
      tessedit_char_whitelist:
        columnKey === "patients"
          ? "0123456789"
          : "0123456789,",

      /*
       * 数字1個または数値1個。
       */
      tessedit_pageseg_mode: "7",

      preserve_interword_spaces:
        "0",

      user_defined_dpi: "300",
    });

    const result =
      await worker.recognize(blob);

    const raw =
      String(
        result.data.text || ""
      ).trim();

    const value =
      cleanText(raw);

    const confidence =
      Number(
        result.data.confidence || 0
      );

    return {
      variantName,
      raw,
      value,
      confidence,
      score:
        candidateScore(
          columnKey,
          value,
          confidence
        ),
    };
  }

  /*
   * ----------------------------------------------------
   * 3種類の画像処理を試して
   * 最良結果を採用
   * ----------------------------------------------------
   */

  async function recognizeCell(
    worker,
    rawCanvas,
    columnKey
  ) {
    const variants = [
      {
        name: "gray",
        canvas:
          makeGrayVariant(
            rawCanvas
          ),
      },
      {
        name: "threshold160",
        canvas:
          makeThresholdVariant(
            rawCanvas,
            160
          ),
      },
      {
        name: "threshold180",
        canvas:
          makeThresholdVariant(
            rawCanvas,
            180
          ),
      },
    ];

    const candidates = [];

    for (
      const variant of variants
    ) {
      const candidate =
        await recognizeVariant(
          worker,
          variant.canvas,
          columnKey,
          variant.name
        );

      candidates.push(
        candidate
      );
    }

    candidates.sort(
      (a, b) =>
        b.score - a.score
    );

    const best =
      candidates[0];

    /*
     * 画面には採用した画像を表示。
     */
    const bestCanvas =
      variants.find(
        (item) =>
          item.name ===
          best.variantName
      )?.canvas;

    return {
      ...best,

      preview:
        bestCanvas
          ? bestCanvas.toDataURL(
              "image/png"
            )
          : "",

      candidates,
    };
  }

  async function analyzeImage() {
    if (
      !file ||
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
        "画像を準備しています…"
      );

      const image =
        await loadImage(file);

      setStatusText(
        "OCRエンジンを準備しています…"
      );

      worker =
        await createWorker(
          "eng",
          1
        );

      const output = [];

      const total =
        TEST_DAYS.length * 3;

      let completed = 0;

      for (
        const day of TEST_DAYS
      ) {
        const row = {
          day,
          cells: [],
        };

        for (
          const columnKey of [
            "patients",
            "insurance",
            "care",
          ]
        ) {
          const column =
            COLUMNS[columnKey];

          setStatusText(
            `${day}日：${column.label}を解析中…`
          );

          const rawCanvas =
            makeRawCellCanvas(
              image,
              day,
              columnKey
            );

          const result =
            await recognizeCell(
              worker,
              rawCanvas,
              columnKey
            );

          row.cells.push({
            key:
              columnKey,

            label:
              column.label,

            preview:
              result.preview,

            value:
              result.value,

            raw:
              result.raw,

            confidence:
              result.confidence,

            variant:
              result.variantName,

            candidates:
              result.candidates,
          });

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

        output.push(row);
      }

      const finished =
        performance.now();

      setResults(output);

      setElapsed(
        (
          (finished -
            started) /
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
          🔒 画像・診療データは
          サーバーに保存されません
        </div>

        <section className="card">

          <span className="step">
            STEP 1
          </span>

          <h2>
            スクリーンショットを選択
          </h2>

          <p className="description">
            7・14・21・28日の
            OCR性能を確認します。
          </p>

          <input
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={
              handleFile
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
            ＋ スクリーンショットを選択
          </button>

          {file && (
            <div className="selected">
              {file.name}
            </div>
          )}

        </section>

        <section className="card">

          <span className="step">
            STEP 2
          </span>

          <h2>
            モアレ低減OCR
          </h2>

          <p className="description">
            3種類の画像処理を自動で試し、
            最も信頼できる結果を採用します。
          </p>

          <button
            className={
              file
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              !file ||
              isAnalyzing
            }
            onClick={
              analyzeImage
            }
          >
            {isAnalyzing
              ? "解析中…"
              : "4日分を解析"}
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
            </div>
          )}

          {elapsed && (
            <div className="selected">
              解析時間：
              <strong>
                {elapsed}秒
              </strong>
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

        </section>

        {results.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              OCR結果
            </h2>

            <p className="description">
              今回は採用された画像処理と
              OCR結果も表示します。
            </p>

            {results.map(
              (row) => (
                <div
                  key={row.day}
                  style={{
                    marginBottom:
                      "34px",
                  }}
                >

                  <h3
                    style={{
                      fontSize:
                        "22px",
                      marginBottom:
                        "14px",
                    }}
                  >
                    {row.day}日
                  </h3>

                  <div
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        "repeat(3, minmax(0, 1fr))",

                      gap: "8px",
                    }}
                  >

                    {row.cells.map(
                      (cell) => (
                        <div
                          key={
                            cell.key
                          }
                          style={{
                            minWidth:
                              0,
                          }}
                        >

                          <div
                            style={{
                              fontSize:
                                "11px",

                              fontWeight:
                                700,

                              textAlign:
                                "center",

                              marginBottom:
                                "5px",
                            }}
                          >
                            {cell.label}
                          </div>

                          <div
                            style={{
                              height:
                                "90px",

                              border:
                                "1px solid #cbd5e1",

                              borderRadius:
                                "10px",

                              background:
                                "white",

                              display:
                                "flex",

                              alignItems:
                                "center",

                              justifyContent:
                                "center",

                              overflow:
                                "hidden",

                              padding:
                                "4px",
                            }}
                          >
                            <img
                              src={
                                cell.preview
                              }
                              alt=""
                              style={{
                                width:
                                  "100%",

                                maxHeight:
                                  "80px",

                                objectFit:
                                  "contain",
                              }}
                            />
                          </div>

                          <div
                            style={{
                              marginTop:
                                "7px",

                              background:
                                "#f8fafc",

                              borderRadius:
                                "8px",

                              padding:
                                "7px 4px",

                              textAlign:
                                "center",

                              minHeight:
                                "72px",
                            }}
                          >
                            <strong
                              style={{
                                fontSize:
                                  "18px",
                              }}
                            >
                              {cell.value ||
                                "（空）"}
                            </strong>

                            <br />

                            <span
                              style={{
                                fontSize:
                                  "9px",

                                color:
                                  "#64748b",
                              }}
                            >
                              {
                                cell.variant
                              }

                              {" / "}

                              conf
                              {" "}
                              {Math.round(
                                cell.confidence
                              )}
                            </span>
                          </div>

                        </div>
                      )
                    )}

                  </div>

                </div>
              )
            )}

          </section>
        )}

        <footer>
          モアレ低減＋複数候補OCRテスト
        </footer>

      </section>
    </main>
  );
}