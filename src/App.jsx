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
   * =====================================================
   * 前に目視確認で合っていた縦位置
   * =====================================================
   */

  const ROW_1_CENTER = 0.0550;
  const ROW_STEP = 0.0267;

  /*
   * =====================================================
   * スライダーで合わせた横位置
   * =====================================================
   */

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

  /*
   * 今回はこの4日だけ。
   */
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
   * =====================================================
   * OCR用セル画像作成
   * =====================================================
   *
   * ポイント：
   *
   * ・以前うまく見えていた座標をそのまま使用
   * ・上下の隣接行を入れない
   * ・表の縦罫線を自動的に消す
   * ・モニター撮影のモアレを少し抑える
   * ・数字を大きくしてOCR
   */

  function makeCellCanvas(
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

    /*
     * 行の高さ。
     *
     * 前後の行を拾わないよう、
     * 行間隔の約62%。
     */
    const sourceHeight =
      image.height *
      ROW_STEP *
      0.62;

    let sourceX =
      image.width * column.x;

    let sourceWidth =
      image.width * column.w;

    /*
     * 列端の罫線を少し除外。
     *
     * 実患者は幅が狭いので少なめ。
     */
    const sideTrim =
      columnKey === "patients"
        ? 0.06
        : 0.045;

    sourceX +=
      sourceWidth * sideTrim;

    sourceWidth *=
      1 - sideTrim * 2;

    const sourceY =
      centerY -
      sourceHeight / 2;

    /*
     * まず原寸に近い中間Canvasを作る。
     */
    const base =
      document.createElement("canvas");

    base.width =
      Math.max(
        20,
        Math.round(sourceWidth)
      );

    base.height =
      Math.max(
        15,
        Math.round(sourceHeight)
      );

    const baseCtx =
      base.getContext("2d", {
        willReadFrequently: true,
      });

    baseCtx.fillStyle = "#ffffff";
    baseCtx.fillRect(
      0,
      0,
      base.width,
      base.height
    );

    /*
     * モアレ軽減のため少し平滑化。
     */
    baseCtx.imageSmoothingEnabled = true;
    baseCtx.imageSmoothingQuality = "high";

    baseCtx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      base.width,
      base.height
    );

    /*
     * グレースケール＋軽いコントラスト。
     */
    const imageData =
      baseCtx.getImageData(
        0,
        0,
        base.width,
        base.height
      );

    const pixels =
      imageData.data;

    for (
      let i = 0;
      i < pixels.length;
      i += 4
    ) {
      const gray =
        pixels[i] * 0.299 +
        pixels[i + 1] * 0.587 +
        pixels[i + 2] * 0.114;

      /*
       * 強すぎる2値化はしない。
       */
      let value =
        (gray - 128) * 1.45 + 128;

      value =
        Math.max(
          0,
          Math.min(255, value)
        );

      /*
       * 明るい背景は少し白へ。
       */
      if (value > 185) {
        value =
          Math.min(
            255,
            value + 18
          );
      }

      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }

    baseCtx.putImageData(
      imageData,
      0,
      0
    );

    /*
     * ===================================================
     * 縦罫線を除去
     * ===================================================
     *
     * 1列の大部分が黒ければ
     * 表の縦線と判断して白くする。
     */

    const cleaned =
      baseCtx.getImageData(
        0,
        0,
        base.width,
        base.height
      );

    const cleanedPixels =
      cleaned.data;

    for (
      let x = 0;
      x < base.width;
      x++
    ) {
      let darkCount = 0;

      for (
        let y = 0;
        y < base.height;
        y++
      ) {
        const index =
          (y * base.width + x) * 4;

        const value =
          cleanedPixels[index];

        if (value < 95) {
          darkCount++;
        }
      }

      /*
       * 高さの65%以上が暗いなら
       * 縦罫線の可能性が高い。
       */
      if (
        darkCount /
          base.height >
        0.65
      ) {
        /*
         * 罫線は1〜数pxあることがあるため
         * 左右1pxも白にする。
         */
        for (
          let dx = -1;
          dx <= 1;
          dx++
        ) {
          const targetX =
            x + dx;

          if (
            targetX < 0 ||
            targetX >= base.width
          ) {
            continue;
          }

          for (
            let y = 0;
            y < base.height;
            y++
          ) {
            const index =
              (
                y *
                  base.width +
                targetX
              ) *
              4;

            cleanedPixels[index] = 255;
            cleanedPixels[index + 1] = 255;
            cleanedPixels[index + 2] = 255;
            cleanedPixels[index + 3] = 255;
          }
        }
      }
    }

    baseCtx.putImageData(
      cleaned,
      0,
      0
    );

    /*
     * ===================================================
     * OCR用に拡大
     * ===================================================
     */

    const scale =
      columnKey === "patients"
        ? 7
        : 5;

    const output =
      document.createElement("canvas");

    output.width =
      Math.max(
        220,
        base.width * scale
      );

    output.height =
      Math.max(
        100,
        base.height * scale
      );

    const outputCtx =
      output.getContext("2d");

    outputCtx.fillStyle = "#ffffff";

    outputCtx.fillRect(
      0,
      0,
      output.width,
      output.height
    );

    outputCtx.imageSmoothingEnabled = true;
    outputCtx.imageSmoothingQuality = "high";

    outputCtx.drawImage(
      base,
      0,
      0,
      output.width,
      output.height
    );

    return output;
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

  function normalizeNumber(text) {
    const raw =
      String(text || "")
        .trim();

    const cleaned =
      raw
        .replace(/\s/g, "")
        .replace(/[^\d,]/g, "");

    if (!/\d/.test(cleaned)) {
      return "";
    }

    return cleaned;
  }

  async function recognizeCell(
    worker,
    canvas,
    columnKey
  ) {
    const blob =
      await canvasToBlob(canvas);

    /*
     * PSM 8 = 1単語。
     *
     * 今回のセルOCRでは
     * PSM 7（1行）より適しています。
     */
    await worker.setParameters({
      tessedit_char_whitelist:
        columnKey === "patients"
          ? "0123456789"
          : "0123456789,",

      tessedit_pageseg_mode: "8",

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

    return {
      raw,
      normalized:
        normalizeNumber(raw),
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

          /*
           * OCRへ渡すCanvasそのもの。
           */
          const canvas =
            makeCellCanvas(
              image,
              day,
              columnKey
            );

          /*
           * 画面確認用。
           */
          const preview =
            canvas.toDataURL(
              "image/png"
            );

          const recognized =
            await recognizeCell(
              worker,
              canvas,
              columnKey
            );

          row.cells.push({
            key: columnKey,
            label:
              column.label,
            preview,
            raw:
              recognized.raw,
            value:
              recognized.normalized,
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
            今回は7・14・21・28日の
            4日だけを検証します。
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
            セルOCR検証
          </h2>

          <p className="description">
            OCRへ渡した画像そのものと、
            認識結果を同時に表示します。
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
              OCR入力画像と結果
            </h2>

            <p className="description">
              画像の数字と下のOCR結果が
              一致するか確認してください。
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
                              textAlign:
                                "center",
                              fontSize:
                                "12px",
                              fontWeight:
                                700,
                              marginBottom:
                                "6px",
                            }}
                          >
                            {cell.label}
                          </div>

                          <div
                            style={{
                              height:
                                "95px",
                              border:
                                "1px solid #cbd5e1",
                              borderRadius:
                                "10px",
                              background:
                                "#ffffff",
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
                              alt={
                                cell.label
                              }
                              style={{
                                maxWidth:
                                  "100%",
                                maxHeight:
                                  "85px",
                                objectFit:
                                  "contain",
                              }}
                            />
                          </div>

                          <div
                            style={{
                              marginTop:
                                "8px",
                              padding:
                                "8px 4px",
                              background:
                                "#f8fafc",
                              borderRadius:
                                "8px",
                              textAlign:
                                "center",
                              minHeight:
                                "54px",
                              fontSize:
                                "12px",
                            }}
                          >
                            OCR
                            <br />

                            <strong
                              style={{
                                fontSize:
                                  "16px",
                              }}
                            >
                              {cell.value ||
                                "（空）"}
                            </strong>

                            {cell.raw &&
                              cell.raw !==
                                cell.value && (
                                <>
                                  <br />
                                  <span
                                    style={{
                                      color:
                                        "#64748b",
                                      fontSize:
                                        "10px",
                                    }}
                                  >
                                    raw:
                                    {
                                      cell.raw
                                    }
                                  </span>
                                </>
                              )}
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
          まず切り抜きとOCRを分離して確認します
        </footer>
      </section>
    </main>
  );
}