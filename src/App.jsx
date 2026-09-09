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

  function clamp(value) {
    return Math.max(0, Math.min(255, value));
  }

  /*
   * 元画像から1セルを切り出す
   */
  function makeRawCell(image, day, columnKey) {
    const column = COLUMNS[columnKey];

    const centerY =
      image.height *
      (ROW_1_CENTER + (day - 1) * ROW_STEP);

    const sourceHeight =
      image.height *
      ROW_STEP *
      0.60;

    let sourceX =
      image.width * column.x;

    let sourceWidth =
      image.width * column.w;

    const sourceY =
      centerY - sourceHeight / 2;

    /*
     * 左右の罫線がなるべく入らないよう少し削る
     */
    const sideTrim =
      columnKey === "patients"
        ? 0.025
        : 0.02;

    sourceX += sourceWidth * sideTrim;
    sourceWidth *= 1 - sideTrim * 2;

    const canvas =
      document.createElement("canvas");

    canvas.width = Math.max(
      30,
      Math.round(sourceWidth)
    );

    canvas.height = Math.max(
      18,
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
   * モアレを減らすため、
   * いったん縮小してから再拡大
   */
  function reduceMoire(source) {
    const small =
      document.createElement("canvas");

    small.width = Math.max(
      20,
      Math.round(source.width * 0.38)
    );

    small.height = Math.max(
      14,
      Math.round(source.height * 0.38)
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

    return small;
  }

  /*
   * グレースケール化
   */
  function grayscale(source) {
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

    for (let i = 0; i < data.length; i += 4) {
      const gray =
        data[i] * 0.299 +
        data[i + 1] * 0.587 +
        data[i + 2] * 0.114;

      let value =
        (gray - 128) * 1.18 + 128;

      value = clamp(value);

      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas;
  }

  /*
   * セル内に残った縦罫線を除去
   */
  function removeVerticalRules(source) {
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

    for (let x = 0; x < canvas.width; x++) {
      let dark = 0;

      for (let y = 0; y < canvas.height; y++) {
        const i =
          (y * canvas.width + x) * 4;

        if (data[i] < 105) {
          dark++;
        }
      }

      /*
       * 高さの75%以上が暗ければ縦罫線
       */
      if (
        dark / canvas.height >
        0.75
      ) {
        for (let dx = -1; dx <= 1; dx++) {
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
              (y * canvas.width + px) * 4;

            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas;
  }

  /*
   * 数字が存在している範囲だけ自動トリミング
   */
  function autoCropInk(source) {
    const ctx =
      source.getContext("2d", {
        willReadFrequently: true,
      });

    const imageData =
      ctx.getImageData(
        0,
        0,
        source.width,
        source.height
      );

    const data = imageData.data;

    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;

    /*
     * かなり濃い画素だけを
     * 「文字候補」とする
     */
    for (
      let y = 0;
      y < source.height;
      y++
    ) {
      for (
        let x = 0;
        x < source.width;
        x++
      ) {
        const i =
          (y * source.width + x) * 4;

        const value = data[i];

        if (value < 135) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    /*
     * 文字がなければ元画像を返す
     */
    if (
      maxX < minX ||
      maxY < minY
    ) {
      return source;
    }

    /*
     * 少し余白を追加
     */
    const padX = 2;
    const padY = 2;

    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);

    maxX = Math.min(
      source.width - 1,
      maxX + padX
    );

    maxY = Math.min(
      source.height - 1,
      maxY + padY
    );

    const cropWidth =
      maxX - minX + 1;

    const cropHeight =
      maxY - minY + 1;

    /*
     * OCRには十分な白余白を付ける
     */
    const scale = 8;

    const target =
      document.createElement("canvas");

    target.width = Math.max(
      300,
      cropWidth * scale + 100
    );

    target.height = Math.max(
      140,
      cropHeight * scale + 70
    );

    const tctx =
      target.getContext("2d");

    tctx.fillStyle = "#fff";

    tctx.fillRect(
      0,
      0,
      target.width,
      target.height
    );

    const destinationWidth =
      cropWidth * scale;

    const destinationHeight =
      cropHeight * scale;

    const dx =
      (target.width -
        destinationWidth) /
      2;

    const dy =
      (target.height -
        destinationHeight) /
      2;

    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";

    tctx.drawImage(
      source,
      minX,
      minY,
      cropWidth,
      cropHeight,
      dx,
      dy,
      destinationWidth,
      destinationHeight
    );

    return target;
  }

  /*
   * 2値化バージョン
   */
  function thresholdCanvas(source, threshold) {
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
      const v =
        data[i] < threshold
          ? 0
          : 255;

      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

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

    if (!/\d/.test(value)) {
      return "";
    }

    return value;
  }

  /*
   * 帳票として自然な候補を評価
   */
  function scoreCandidate(
    columnKey,
    value
  ) {
    if (!value) return -1000;

    const digits =
      value.replace(/,/g, "");

    if (!/^\d+$/.test(digits)) {
      return -1000;
    }

    const n = Number(digits);

    let score = 0;

    if (columnKey === "patients") {
      if (n >= 1 && n <= 99) {
        score += 100;
      }

      if (digits.length === 2) {
        score += 50;
      }

      if (digits.length === 1) {
        score += 10;
      }

      if (n > 99) {
        score -= 200;
      }
    } else {
      /*
       * 点数は今回の帳票では
       * 4～5桁が最も自然
       */
      if (
        digits.length === 5
      ) {
        score += 120;
      }

      if (
        digits.length === 4
      ) {
        score += 100;
      }

      if (
        digits.length === 3
      ) {
        score += 15;
      }

      if (
        digits.length <= 2
      ) {
        score -= 100;
      }

      if (
        n >= 1000 &&
        n <= 50000
      ) {
        score += 70;
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
      psm,
      variant,
      raw,
      value,
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
    const raw =
      makeRawCell(
        image,
        day,
        columnKey
      );

    const reduced =
      reduceMoire(raw);

    const gray =
      grayscale(reduced);

    const noLines =
      removeVerticalRules(gray);

    const cropped =
      autoCropInk(noLines);

    const binary145 =
      thresholdCanvas(
        cropped,
        145
      );

    const binary165 =
      thresholdCanvas(
        cropped,
        165
      );

    const variants = [
      {
        name: "gray",
        canvas: cropped,
      },
      {
        name: "bin145",
        canvas: binary145,
      },
      {
        name: "bin165",
        canvas: binary165,
      },
    ];

    const candidates = [];

    /*
     * 1行、1単語、raw-line を試す
     */
    const psms = [7, 8, 13];

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
        (v) =>
          v.name ===
          best.variant
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
    if (!file || isAnalyzing) {
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
            key: columnKey,
            label:
              COLUMNS[columnKey].label,

            value:
              result.value,

            raw:
              result.raw,

            variant:
              result.variant,

            psm:
              result.psm,

            preview:
              result.preview,

            candidates:
              result.candidates,
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
            今回も7・14・21・28日の
            4日でOCR精度を検証します。
          </p>

          <input
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={handleFile}
          />

          <button
            className="select-button"
            disabled={isAnalyzing}
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
            改良OCR
          </h2>

          <p className="description">
            モアレ低減・罫線除去・
            数字領域の自動トリミングを行います。
          </p>

          <button
            className={
              file
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              !file || isAnalyzing
            }
            onClick={analyzeImage}
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

            {results.map((row) => (
              <div
                key={row.day}
                style={{
                  marginBottom: "34px",
                }}
              >
                <h3
                  style={{
                    fontSize: "22px",
                    marginBottom:
                      "14px",
                  }}
                >
                  {row.day}日
                </h3>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(3, minmax(0, 1fr))",
                    gap: "8px",
                  }}
                >
                  {row.cells.map(
                    (cell) => (
                      <div
                        key={cell.key}
                        style={{
                          minWidth: 0,
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
                              "100px",
                            border:
                              "1px solid #cbd5e1",
                            borderRadius:
                              "10px",
                            display:
                              "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "center",
                            overflow:
                              "hidden",
                            background:
                              "#fff",
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
                              "70px",
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
                            {cell.variant}
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
            ))}
          </section>
        )}

        <footer>
          数字領域自動トリミングOCR
        </footer>
      </section>
    </main>
  );
}