import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(null);
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
    },
    {
      key: "insurance",
      label: "保険診療分",
      x: 0.495,
      y: 0.035,
      w: 0.055,
      h: 0.755,
    },
    {
      key: "care",
      label: "介護保険",
      x: 0.735,
      y: 0.035,
      w: 0.060,
      h: 0.755,
    },
  ];

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
    setResults([]);
    setElapsed(null);
    setProgress(0);
    setStatusText("");
    setError("");
  }

  function cropImage(file, crop) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        try {
          const sx = Math.floor(img.width * crop.x);
          const sy = Math.floor(img.height * crop.y);
          const sw = Math.floor(img.width * crop.w);
          const sh = Math.floor(img.height * crop.h);

          const scale = 1.35;
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(sw * scale);
          canvas.height = Math.floor(sh * scale);

          const ctx = canvas.getContext("2d", {
            willReadFrequently: true,
          });

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

          for (let i = 0; i < data.length; i += 4) {
            const gray =
              data[i] * 0.299 +
              data[i + 1] * 0.587 +
              data[i + 2] * 0.114;

            const value = gray < 165 ? 0 : 255;

            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
            data[i + 3] = 255;
          }

          ctx.putImageData(imageData, 0, 0);

          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);

              if (!blob) {
                reject(new Error("画像変換に失敗しました"));
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
        reject(new Error("画像を読み込めませんでした"));
      };

      img.src = url;
    });
  }

  async function analyzeImages() {
    if (files.length === 0 || isAnalyzing) return;

    setIsAnalyzing(true);
    setProgress(0);
    setResults([]);
    setElapsed(null);
    setError("");

    const started = performance.now();
    let worker;

    try {
      setStatusText("OCRエンジンを準備しています…");

      worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (message.status === "recognizing text") {
            setProgress(
              Math.round((message.progress || 0) * 100)
            );
          }
        },
      });

      await worker.setParameters({
        tessedit_char_whitelist: "0123456789,",
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "6",
      });

      const output = [];

      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        const columnResults = {};

        for (let cropIndex = 0; cropIndex < crops.length; cropIndex++) {
          const crop = crops[cropIndex];

          setStatusText(
            `${fileIndex + 1}/${files.length}枚目：${crop.label}を解析中…`
          );

          const blob = await cropImage(file, crop);
          setProgress(0);

          const result = await worker.recognize(blob);

          columnResults[crop.key] = result.data.text || "";
        }

        output.push({
          fileName: file.name,
          ...columnResults,
        });
      }

      const finished = performance.now();

      setElapsed(((finished - started) / 1000).toFixed(1));
      setResults(output);
      setProgress(100);
      setStatusText("解析完了");
    } catch (e) {
      console.error(e);
      setError("OCR解析中にエラーが発生しました。");
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
            <p>診療日別集計表 → Excel</p>
          </div>
        </header>

        <div className="privacy">
          🔒 画像・診療データはサーバーに保存されません
        </div>

        <section className="card">
          <span className="step">STEP 1</span>
          <h2>スクリーンショットを選択</h2>

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
            onClick={() => inputRef.current?.click()}
          >
            ＋ スクリーンショットを選択
          </button>

          {files.length > 0 && (
            <div className="selected">
              <strong>{files.length}枚</strong>選択しました
            </div>
          )}
        </section>

        <section className="card">
          <span className="step">STEP 2</span>
          <h2>3列OCR</h2>

          <button
            className={
              files.length > 0
                ? "select-button"
                : "disabled-button"
            }
            disabled={files.length === 0 || isAnalyzing}
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
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {elapsed && (
            <div className="selected">
              解析時間：<strong>{elapsed}秒</strong>
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </section>

        {results.map((result, index) => (
          <section
            className="card"
            key={`${result.fileName}-${index}`}
          >
            <span className="step">STEP 3</span>
            <h2>OCR結果</h2>

            <p className="description">
              今回は3列だけ読み取っています。
            </p>

            <strong>{result.fileName}</strong>

            <div style={{ overflowX: "auto", marginTop: "16px" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "13px",
                }}
              >
                <thead>
                  <tr>
                    <th style={cellStyle}>実患者</th>
                    <th style={cellStyle}>保険診療分</th>
                    <th style={cellStyle}>介護保険</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td style={cellStyle}>
                      <pre style={preStyle}>
                        {result.patients}
                      </pre>
                    </td>

                    <td style={cellStyle}>
                      <pre style={preStyle}>
                        {result.insurance}
                      </pre>
                    </td>

                    <td style={cellStyle}>
                      <pre style={preStyle}>
                        {result.care}
                      </pre>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))}

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