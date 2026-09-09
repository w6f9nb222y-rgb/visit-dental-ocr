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
   * 現在かなり合っている位置は固定
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

  /*
   * --------------------------------------------------
   * 元セル切り抜き
   * --------------------------------------------------
   */

  function makeRawCell(image, day, columnKey) {
    const column = COLUMNS[columnKey];

    const centerY =
      image.height *
      (ROW_1_CENTER + (day - 1) * ROW_STEP);

    /*
     * 隣の行が入らない程度
     */
    const sourceHeight =
      image.height *
      ROW_STEP *
      0.60;

    const sourceY =
      centerY - sourceHeight / 2;

    const sourceX =
      image.width * column.x;

    const sourceWidth =
      image.width * column.w;

    const canvas =
      document.createElement("canvas");

    canvas.width =
      Math.max(
        40,
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
   * --------------------------------------------------
   * モアレ低減
   *
   * 前回ほど強くは縮小しない。
   * 0.72倍程度で高周波だけ少し均す。
   * --------------------------------------------------
   */

  function reduceMoire(source) {
    const small =
      document.createElement("canvas");

    small.width =
      Math.max(
        30,
        Math.round(source.width * 0.72)
      );

    small.height =
      Math.max(
        16,
        Math.round(source.height * 0.72)
      );

    const sctx =
      small.getContext("2d", {
        willReadFrequently: true,
      });

    sctx.fillStyle = "#fff";
    sctx.fillRect(
      0,
      0,
      small.width,
      small.height
    );

    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";

    sctx.drawImage(
      source,
      0,
      0,
      small.width,
      small.height
    );

    /*
     * OCR用に再拡大
     */
    const output =
      document.createElement("canvas");

    const targetHeight = 180;

    const scale =
      targetHeight / small.height;

    output.width =
      Math.max(
        300,
        Math.round(small.width * scale)
      );

    output.height =
      targetHeight;

    const ctx =
      output.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.fillStyle = "#fff";
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
   * --------------------------------------------------
   * グレースケール
   * --------------------------------------------------
   */

  function makeGray(source) {
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

    ctx.putImageData(imageData, 0, 0);

    return canvas;
  }

  /*
   * --------------------------------------------------
   * 簡単な3x3ぼかし
   *
   * モニター画素の格子を少し平均化
   * --------------------------------------------------
   */

  function blurCanvas(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const src =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const out =
      ctx.createImageData(
        canvas.width,
        canvas.height
      );

    const w = canvas.width;
    const h = canvas.height;

    for (
      let y = 1;
      y < h - 1;
      y++
    ) {
      for (
        let x = 1;
        x < w - 1;
        x++
      ) {
        let sum = 0;

        for (
          let dy = -1;
          dy <= 1;
          dy++
        ) {
          for (
            let dx = -1;
            dx <= 1;
            dx++
          ) {
            const index =
              (
                (y + dy) * w +
                (x + dx)
              ) * 4;

            sum += src.data[index];
          }
        }

        const value =
          Math.round(sum / 9);

        const index =
          (y * w + x) * 4;

        out.data[index] = value;
        out.data[index + 1] = value;
        out.data[index + 2] = value;
        out.data[index + 3] = 255;
      }
    }

    ctx.fillStyle = "#fff";
    ctx.fillRect(
      0,
      0,
      w,
      h
    );

    ctx.putImageData(out, 0, 0);

    return canvas;
  }

  /*
   * --------------------------------------------------
   * Otsu法による自動2値化
   * --------------------------------------------------
   */

  function otsuThreshold(source) {
    const ctx =
      source.getContext("2d", {
        willReadFrequently: true,
      });

    const img =
      ctx.getImageData(
        0,
        0,
        source.width,
        source.height
      );

    const histogram =
      new Array(256).fill(0);

    for (
      let i = 0;
      i < img.data.length;
      i += 4
    ) {
      histogram[
        Math.round(img.data[i])
      ]++;
    }

    const total =
      source.width *
      source.height;

    let sum = 0;

    for (
      let i = 0;
      i < 256;
      i++
    ) {
      sum += i * histogram[i];
    }

    let sumB = 0;
    let weightB = 0;
    let weightF = 0;

    let maxVariance = 0;
    let threshold = 128;

    for (
      let t = 0;
      t < 256;
      t++
    ) {
      weightB += histogram[t];

      if (weightB === 0) {
        continue;
      }

      weightF =
        total - weightB;

      if (weightF === 0) {
        break;
      }

      sumB +=
        t * histogram[t];

      const meanB =
        sumB / weightB;

      const meanF =
        (sum - sumB) /
        weightF;

      const variance =
        weightB *
        weightF *
        Math.pow(
          meanB - meanF,
          2
        );

      if (
        variance >
        maxVariance
      ) {
        maxVariance =
          variance;

        threshold = t;
      }
    }

    return threshold;
  }

  /*
   * --------------------------------------------------
   * 2値化
   * --------------------------------------------------
   */

  function makeBinary(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const threshold =
      otsuThreshold(canvas);

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
      /*
       * Otsu値を少し暗めに補正。
       * 網目を拾いすぎないため。
       */
      const value =
        data[i] <
        threshold - 8
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
   * --------------------------------------------------
   * 縦罫線除去
   * --------------------------------------------------
   */

  function removeVerticalLines(source) {
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
      let x = 0;
      x < canvas.width;
      x++
    ) {
      let black = 0;

      for (
        let y = 0;
        y < canvas.height;
        y++
      ) {
        const i =
          (
            y * canvas.width +
            x
          ) * 4;

        if (data[i] < 40) {
          black++;
        }
      }

      /*
       * 画面高さの55%以上
       * 真っ黒なら罫線扱い。
       */
      if (
        black /
          canvas.height >
        0.55
      ) {
        for (
          let dx = -2;
          dx <= 2;
          dx++
        ) {
          const px = x + dx;

          if (
            px < 0 ||
            px >= canvas.width
          ) {
            continue;
          }

          for (
            let y = 0;
            y < canvas.height;
            y++
          ) {
            const i =
              (
                y *
                  canvas.width +
                px
              ) * 4;

            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /*
   * --------------------------------------------------
   * OCR用余白追加
   * --------------------------------------------------
   */

  function addPadding(source) {
    const padX = 80;
    const padY = 45;

    const canvas =
      document.createElement("canvas");

    canvas.width =
      source.width +
      padX * 2;

    canvas.height =
      source.height +
      padY * 2;

    const ctx =
      canvas.getContext("2d");

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      source,
      padX,
      padY
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
   * --------------------------------------------------
   * OCR文字列整理
   *
   * カンマは完全に無視
   * --------------------------------------------------
   */

  function cleanDigits(text) {
    const digits =
      String(text || "")
        .replace(/\D/g, "");

    return digits;
  }

  /*
   * --------------------------------------------------
   * 候補評価
   *
   * 極端に長い数字列は即失格
   * --------------------------------------------------
   */

  function scoreCandidate(
    columnKey,
    value
  ) {
    if (!value) {
      return -9999;
    }

    const len = value.length;
    const n = Number(value);

    if (
      !Number.isFinite(n)
    ) {
      return -9999;
    }

    let score = 0;

    if (
      columnKey ===
      "patients"
    ) {
      /*
       * 実患者
       * 基本1〜2桁
       */
      if (len === 2) {
        score += 200;
      }

      if (len === 1) {
        score += 80;
      }

      if (len > 2) {
        score -=
          500 *
          (len - 2);
      }

      if (
        n >= 1 &&
        n <= 99
      ) {
        score += 100;
      }

      if (n === 0) {
        score += 30;
      }
    } else {
      /*
       * 保険・介護
       * 主に4〜5桁
       */
      if (len === 5) {
        score += 250;
      }

      if (len === 4) {
        score += 200;
      }

      if (len === 3) {
        score += 50;
      }

      if (len <= 2) {
        score -= 250;
      }

      if (len > 5) {
        score -=
          700 *
          (len - 5);
      }

      if (
        n >= 1000 &&
        n <= 99999
      ) {
        score += 120;
      }
    }

    return score;
  }

  async function runOCR(
    worker,
    canvas,
    psm,
    columnKey,
    variant
  ) {
    const blob =
      await canvasToBlob(canvas);

    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789",

      /*
       * 数字列のみ
       */
      tessedit_pageseg_mode:
        String(psm),

      preserve_interword_spaces:
        "0",

      user_defined_dpi:
        "300",
    });

    const result =
      await worker.recognize(
        blob
      );

    const raw =
      String(
        result.data.text || ""
      );

    const value =
      cleanDigits(raw);

    return {
      raw,
      value,
      variant,
      psm,
      score:
        scoreCandidate(
          columnKey,
          value
        ),
    };
  }

  /*
   * --------------------------------------------------
   * 1セル認識
   * --------------------------------------------------
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

    const reduced =
      reduceMoire(raw);

    const gray =
      makeGray(reduced);

    const blurred =
      blurCanvas(gray);

    const binary =
      makeBinary(blurred);

    const cleanBinary =
      removeVerticalLines(
        binary
      );

    const paddedGray =
      addPadding(gray);

    const paddedBlur =
      addPadding(blurred);

    const paddedBinary =
      addPadding(cleanBinary);

    const variants = [
      {
        name: "gray",
        canvas: paddedGray,
      },
      {
        name: "blur",
        canvas: paddedBlur,
      },
      {
        name: "binary",
        canvas: paddedBinary,
      },
    ];

    /*
     * PSM6は長いゴミ列を出しやすかったので除外
     */
    const psms = [
      7,
      8,
      13,
    ];

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

        candidates.push(
          result
        );
      }
    }

    candidates.sort(
      (a, b) =>
        b.score - a.score
    );

    const best =
      candidates[0];

    const bestCanvas =
      variants.find(
        (item) =>
          item.name ===
          best.variant
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
        "画像を読み込んでいます…"
      );

      const image =
        await loadImage(file);

      setStatusText(
        "数字認識エンジンを準備しています…"
      );

      worker =
        await createWorker(
          "eng",
          1
        );

      const output = [];

      const total =
        TEST_DAYS.length *
        3;

      let completed = 0;

      for (
        const day of
        TEST_DAYS
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
              COLUMNS[
                columnKey
              ].label,

            value:
              result.value,

            raw:
              result.raw,

            preview:
              result.preview,

            variant:
              result.variant,

            psm:
              result.psm,
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

  function formatNumber(
    value,
    columnKey
  ) {
    if (!value) {
      return "（空）";
    }

    if (
      columnKey ===
      "patients"
    ) {
      return value;
    }

    const n =
      Number(value);

    if (
      !Number.isFinite(n)
    ) {
      return value;
    }

    return n.toLocaleString(
      "ja-JP"
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
            7・14・21・28日の
            数字認識を確認します。
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
            数字専用OCR
          </h2>

          <p className="description">
            カンマを無視し、
            数字だけを認識します。
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
              数字認識結果
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
                              textAlign:
                                "center",
                              fontSize:
                                "11px",
                              fontWeight:
                                700,
                              marginBottom:
                                "5px",
                            }}
                          >
                            {cell.label}
                          </div>

                          <div
                            style={{
                              height:
                                "105px",
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
                                  "95px",
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
                              {formatNumber(
                                cell.value,
                                cell.key
                              )}
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
          数字専用OCRテスト
        </footer>

      </section>
    </main>
  );
}