import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(null);
  const [engineTime, setEngineTime] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const crops = [
    {
      key: "patients",
      label: "実患者",
      x: 0.438,
      y: 0.035,
      w: 0.030,
      h: 0.755,
      scale: 2.2,
      whitelist: "0123456789",
    },
    {
      key: "insurance",
      label: "保険診療分",
      x: 0.495,
      y: 0.035,
      w: 0.055,
      h: 0.755,
      scale: 1.8,
      whitelist: "0123456789,",
    },
    {
      key: "care",
      label: "介護保険",
      x: 0.735,
      y: 0.035,
      w: 0.060,
      h: 0.755,
      scale: 1.8,
      whitelist: "0123456789,",
    },
  ];

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);

    setFiles(selected);
    setResults([]);
    setElapsed(null);
    setEngineTime(null);
    setProgress(0);
    setStatusText("");
    setError("");
  }

  function clamp(value) {
    return Math.max(0, Math.min(255, value));
  }

  function cropAndEnhanceImage(file, crop) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        try {
          const sx = Math.floor(img.width * crop.x);
          const sy = Math.floor(img.height * crop.y);
          const sw = Math.floor(img.width * crop.w);
          const sh = Math.floor(img.height * crop.h);

          const scale = crop.scale || 1.8;

          const canvas = document.createElement("canvas");

          canvas.width = Math.max(
            1,
            Math.floor(sw * scale)
          );

          canvas.height = Math.max(
            1,
            Math.floor(sh * scale)
          );

          const ctx = canvas.getContext("2d", {
            willReadFrequently: true,
          });

          /*
            モニター撮影画像なので、
            無理に二値化せず拡大してから
            グレースケール＋コントラスト強調します。
          */
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";

          ctx.drawImage(
            img,
            sx,
            sy,
            sw,
            sh,
            0,
            0,
            canvas.width,
            canvas.height
          );

          const imageData = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          );

          const data = imageData.data;

          /*
            1.0 = 元のコントラスト
            1.65 = 少し強め
          */
          const contrast = 1.65;

          for (let i = 0; i < data.length; i += 4) {
            const gray =
              data[i] * 0.299 +
              data[i + 1] * 0.587 +
              data[i + 2] * 0.114;

            /*
              完全な白黒にはせず、
              階調を残したまま数字を強調します。
            */
            let adjusted =
              (gray - 128) * contrast + 128;

            adjusted = clamp(adjusted);

            /*
              背景を少し明るく寄せる
            */
            adjusted =
              adjusted > 175
                ? clamp(adjusted + 18)
                : adjusted;

            data[i] = adjusted;
            data[i + 1] = adjusted;
            data[i + 2] = adjusted;
            data[i + 3] = 255;
          }

          ctx.putImageData(imageData, 0, 0);

          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);

              if (!blob) {
                reject(
                  new Error("画像変換に失敗しました")
                );
                return;
              }

              resolve(blob);
            },
            "image/png",
            1
          );
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);

        reject(
          new Error("画像を読み込めませんでした")
        );
      };

      img.src = url;
    });
  }

  function cleanText(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }

  async function analyzeImages() {
    if (files.length === 0 || isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    setProgress(0);
    setResults([]);
    setElapsed(null);
    setEngineTime(null);
    setError("");

    const totalStarted = performance.now();

    let worker;

    try {
      setStatusText(
        "OCRエンジンを準備しています…"
      );

      const engineStarted = performance.now();

      worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (
            message.status ===
            "recognizing text"
          ) {
            setProgress(
              Math.round(
                (message.progress || 0) * 100
              )
            );
          }
        },
      });

      const engineFinished = performance.now();

      setEngineTime(
        (
          (engineFinished - engineStarted) /
          1000
        ).toFixed(1)
      );

      /*
        Sparse Text モード。
        空欄が多い縦長の帳票列に向いています。
      */
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "11",
        user_defined_dpi: "300",
      });

      const output = [];

      for (
        let fileIndex = 0;
        fileIndex < files.length;
        fileIndex++
      ) {
        const file = files[fileIndex];

        const columnResults = {};
        const timings = {};

        for (
          let cropIndex = 0;
          cropIndex < crops.length;
          cropIndex++
        ) {
          const crop = crops[cropIndex];

          setStatusText(
            `${fileIndex + 1}/${
              files.length
            }枚目：${crop.label}を解析中…`
          );

          setProgress(0);

          const columnStarted =
            performance.now();

          const blob =
            await cropAndEnhanceImage(
              file,
              crop
            );

          /*
            列ごとに許可文字を変更。
          */
          await worker.setParameters({
            tessedit_char_whitelist:
              crop.whitelist,
            preserve_interword_spaces: "1",
            tessedit_pageseg_mode: "11",
            user_defined_dpi: "300",
          });

          const recognition =
            await worker.recognize(blob);

          const columnFinished =
            performance.now();

          columnResults[crop.key] =
            cleanText(
              recognition.data.text
            );

          timings[crop.key] = (
            (columnFinished -
              columnStarted) /
            1000
          ).toFixed(1);
        }

        output.push({
          fileName: file.name,
          ...columnResults,
          timings,
        });
      }

      const totalFinished =
        performance.now();

      setElapsed(
        (
          (totalFinished -
            totalStarted) /
          1000
        ).toFixed(1)
      );

      setResults(output);
      setProgress(100);
      setStatusText("解析完了");
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
          <div className="logo">歯</div>

          <div>
            <h1>訪問診療OCR</h1>
            <p>
              診療日別集計表 → Excel
            </p>
          </div>
        </header>

        <div className="privacy">
          🔒
          画像・診療データはサーバーに保存されません
        </div>

        <section className="card">
          <span className="step">
            STEP 1
          </span>

          <h2>
            スクリーンショットを選択
          </h2>

          <input
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            multiple
            onChange={handleFiles}
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

          {files.length > 0 && (
            <div className="selected">
              <strong>
                {files.length}枚
              </strong>
              選択しました
            </div>
          )}
        </section>

        <section className="card">
          <span className="step">
            STEP 2
          </span>

          <h2>3列OCR</h2>

          <p className="description">
            グレースケール＋
            コントラスト補正で解析します。
          </p>

          <button
            className={
              files.length > 0
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              files.length === 0 ||
              isAnalyzing
            }
            onClick={analyzeImages}
          >
            {isAnalyzing
              ? "解析中…"
              : "必要な3列だけ解析"}
          </button>

          {statusText && (
            <div className="ocr-status">
              <p>{statusText}</p>

              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>
            </div>
          )}

          {elapsed && (
            <div className="selected">
              <div>
                総解析時間：
                <strong>
                  {elapsed}秒
                </strong>
              </div>

              {engineTime && (
                <div
                  style={{
                    marginTop: "6px",
                  }}
                >
                  OCR準備：
                  <strong>
                    {engineTime}秒
                  </strong>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </section>

        {results.map(
          (result, index) => (
            <section
              className="card"
              key={`${result.fileName}-${index}`}
            >
              <span className="step">
                STEP 3
              </span>

              <h2>OCR結果</h2>

              <p className="description">
                3列を個別に読み取った結果です。
              </p>

              <strong>
                {result.fileName}
              </strong>

              <div
                style={{
                  marginTop: "14px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "#f8fafc",
                  fontSize: "12px",
                  lineHeight: "1.7",
                }}
              >
                <div>
                  実患者：
                  {result.timings.patients}秒
                </div>

                <div>
                  保険診療分：
                  {result.timings.insurance}秒
                </div>

                <div>
                  介護保険：
                  {result.timings.care}秒
                </div>
              </div>

              <div
                style={{
                  overflowX: "auto",
                  marginTop: "16px",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse:
                      "collapse",
                    fontSize: "13px",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={cellStyle}>
                        実患者
                      </th>

                      <th style={cellStyle}>
                        保険診療分
                      </th>

                      <th style={cellStyle}>
                        介護保険
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td style={cellStyle}>
                        <pre
                          style={preStyle}
                        >
                          {result.patients}
                        </pre>
                      </td>

                      <td style={cellStyle}>
                        <pre
                          style={preStyle}
                        >
                          {result.insurance}
                        </pre>
                      </td>

                      <td style={cellStyle}>
                        <pre
                          style={preStyle}
                        >
                          {result.care}
                        </pre>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )
        )}

        <footer>
          次はOCR結果を日付ごとの表に変換します
        </footer>
      </section>
    </main>
  );
}

const cellStyle = {
  border: "1px solid #cbd5e1",
  verticalAlign: "top",
  padding: "8px",
  minWidth: "110px",
};

const preStyle = {
  margin: 0,
  whiteSpace: "pre-wrap",
  fontFamily: "monospace",
  lineHeight: 1.5,
  fontSize: "13px",
};