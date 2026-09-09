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
        reject(new Error("画像を読み込めませんでした"));
      };

      image.src = url;
    });
  }

  function makeCellCanvas(image, day, columnKey) {
    const column = COLUMNS[columnKey];

    const centerY =
      image.height *
      (ROW_1_CENTER + (day - 1) * ROW_STEP);

    const sourceHeight =
      image.height *
      ROW_STEP *
      0.62;

    const sourceY =
      centerY - sourceHeight / 2;

    const sourceX =
      image.width * column.x;

    const sourceWidth =
      image.width * column.w;

    const scale =
      columnKey === "patients"
        ? 6
        : 5;

    const canvas =
      document.createElement("canvas");

    canvas.width =
      Math.max(
        240,
        Math.round(sourceWidth * scale)
      );

    canvas.height =
      Math.max(
        110,
        Math.round(sourceHeight * scale)
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

  function makeGrayVariant(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width = source.width;
    canvas.height = source.height;

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

  function makeSlightContrastVariant(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width = source.width;
    canvas.height = source.height;

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

      let value =
        (gray - 128) * 1.10 + 128;

      value =
        Math.max(
          0,
          Math.min(255, value)
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

  function cleanOCR(text) {
    const value =
      String(text || "")
        .replace(/\s/g, "")
        .replace(/[^\d,]/g, "");

    return /\d/.test(value)
      ? value
      : "";
  }

  function scoreCandidate(
    columnKey,
    value
  ) {
    if (!value) {
      return -999;
    }

    const digits =
      value.replace(/,/g, "");

    if (!/^\d+$/.test(digits)) {
      return -999;
    }

    const number =
      Number(digits);

    let score = 0;

    if (columnKey === "patients") {
      if (
        number >= 1 &&
        number <= 99
      ) {
        score += 100;
      }

      if (digits.length === 2) {
        score += 30;
      }

      if (digits.length === 1) {
        score += 5;
      }
    } else {
      if (
        number >= 1000 &&
        number <= 50000
      ) {
        score += 100;
      }

      if (digits.length === 5) {
        score += 35;
      }

      if (digits.length === 4) {
        score += 25;
      }

      if (digits.length <= 2) {
        score -= 50;
      }
    }

    return score;
  }

  async function runOCR(
    worker,
    canvas,
    psm,
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

      tessedit_pageseg_mode:
        String(psm),

      preserve_interword_spaces:
        "0",

      user_defined_dpi:
        "300",
    });

    const result =
      await worker.recognize(blob);

    const raw =
      String(
        result.data.text || ""
      ).trim();

    const value =
      cleanOCR(raw);

    return {
      raw,
      value,
      psm,
      variantName,
      score:
        scoreCandidate(
          columnKey,
          value
        ),
    };
  }

  async function recognizeCell(
    worker,
    image,
    day,
    columnKey
  ) {
    const rawCanvas =
      makeCellCanvas(
        image,
        day,
        columnKey
      );

    const variants = [
      {
        name: "original",
        canvas: rawCanvas,
      },
      {
        name: "gray",
        canvas:
          makeGrayVariant(
            rawCanvas
          ),
      },
      {
        name: "contrast",
        canvas:
          makeSlightContrastVariant(
            rawCanvas
          ),
      },
    ];

    const psms = [6, 7, 8, 13];

    const candidates = [];

    for (
      const variant of variants
    ) {
      for (
        const psm of psms
      ) {
        const result =
          await runOCR(
            worker,
            variant.canvas,
            psm,
            columnKey,
            variant.name
          );

        candidates.push(result);
      }
    }

    candidates.sort(
      (a, b) =>
        b.score - a.score
    );

    const best =
      candidates[0];

    const previewCanvas =
      variants.find(
        (item) =>
          item.name ===
          best.variantName
      )?.canvas;

    return {
      ...best,

      preview:
        previewCanvas
          ? previewCanvas.toDataURL(
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
        "画像を読み込んでいます…"
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
          setStatusText(
            `${day}日：${COLUMNS[columnKey].label}を解析中…`
          );

          const result =
            await recognizeCell(
              worker,
              image,
              day,
              columnKey
            );

          row.cells.push({
            key:
              columnKey,

            label:
              COLUMNS[columnKey].label,

            value:
              result.value,

            raw:
              result.raw,

            preview:
              result.preview,

            variant:
              result.variantName,

            psm:
              result.psm,
          });

          completed++;

          setProgress(
            Math.round(
              (completed / total) *
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
          (finished - started) /
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
          🔒
          画像・診療データは
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
            前処理を最小限にして
            7・14・21・28日の4日で確認します。
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
            最小前処理OCR
          </h2>

          <p className="description">
            元画像・グレースケール・
            軽いコントラストの3種類だけを試します。
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

                      gap:
                        "8px",
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
                                "100px",

                              border:
                                "1px solid #cbd5e1",

                              borderRadius:
                                "10px",

                              background:
                                "#fff",

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
                                  "90px",

                                objectFit:
                                  "contain",
                              }}
                            />
                          </div>

                          <div
                            style={{
                              marginTop:
                                "7px",

                              padding:
                                "8px 3px",

                              textAlign:
                                "center",

                              background:
                                "#f8fafc",

                              borderRadius:
                                "8px",

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

                              PSM
                              {cell.psm}
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
          最小前処理OCRテスト
        </footer>

      </section>
    </main>
  );
}