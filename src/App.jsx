import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);

    setFiles(selected);
    setResults([]);
    setProgress(0);
    setStatusText("");
    setError("");
  }

  async function makeNumericCrop(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        try {
          /*
            今回の診療日別集計表では、
            左側の日付・曜日・天気などを捨て、
            実患者～保険点数～介護点数付近だけを切り出します。
          */

          const sx = Math.floor(img.width * 0.36);
          const sy = Math.floor(img.height * 0.05);
          const sw = Math.floor(img.width * 0.43);
          const sh = Math.floor(img.height * 0.80);

          // OCRしやすいように約2倍へ拡大
          const scale = 2;

          const canvas = document.createElement("canvas");
          canvas.width = sw * scale;
          canvas.height = sh * scale;

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

          // グレースケール＋コントラスト強調＋2値化
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

            // モニター撮影の薄い文字も拾いやすくする
            const value = gray < 180 ? 0 : 255;

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

              resolve({
                blob,
                previewUrl: URL.createObjectURL(blob),
              });
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
    setError("");
    setStatusText("数字専用OCRを準備しています…");

    let worker;

    try {
      /*
        日本語ではなく英語OCRを使用。
        今回欲しいのは数字なので、この方が誤認識を減らせます。
      */
      worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (message.status === "recognizing text") {
            const value = Math.round(
              (message.progress || 0) * 100
            );

            setProgress(value);
          }
        },
      });

      await worker.setParameters({
        tessedit_char_whitelist: "0123456789,",
        preserve_interword_spaces: "1",
      });

      const newResults = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        setStatusText(
          `${i + 1}/${files.length}枚目：画像を補正しています…`
        );

        const processed = await makeNumericCrop(file);

        setStatusText(
          `${i + 1}/${files.length}枚目：数字を認識しています…`
        );

        setProgress(0);

        const result = await worker.recognize(processed.blob);

        newResults.push({
          fileName: file.name,
          text: result.data.text || "",
          previewUrl: processed.previewUrl,
        });
      }

      setResults(newResults);
      setProgress(100);
      setStatusText("数字専用OCRが完了しました");
    } catch (e) {
      console.error(e);

      setError(
        "OCR処理中にエラーが発生しました。もう一度お試しください。"
      );
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
          <h2>診療実績を読み込む</h2>

          <p className="description">
            まず数字部分だけを切り出し、
            帳票専用OCRの精度を確認します。
          </p>

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
              <strong>{files.length}枚</strong>
              の画像を選択しました

              <ul>
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    {file.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section
          className={
            files.length === 0
              ? "card disabled-card"
              : "card"
          }
        >
          <span className="step">STEP 2</span>
          <h2>数字専用OCR</h2>

          <button
            className={
              files.length > 0
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              files.length === 0 || isAnalyzing
            }
            onClick={analyzeImages}
          >
            {isAnalyzing
              ? "解析中…"
              : "数字部分を解析"}
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
            <h2>数字認識テスト</h2>

            <p className="description">
              下の画像がOCRに実際に渡した範囲です。
            </p>

            <img
              src={result.previewUrl}
              alt="OCR対象"
              style={{
                width: "100%",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                marginBottom: "16px",
              }}
            />

            <strong>{result.fileName}</strong>

            <pre
              style={{
                marginTop: "12px",
                padding: "14px",
                minHeight: "150px",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                fontSize: "14px",
                lineHeight: "1.6",
              }}
            >
              {result.text || "数字を認識できませんでした"}
            </pre>
          </section>
        ))}

        <footer>
          診療画像はこの端末内で処理します
        </footer>
      </section>
    </main>
  );
}