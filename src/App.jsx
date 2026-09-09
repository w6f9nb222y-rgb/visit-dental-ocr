import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [ocrResults, setOcrResults] = useState([]);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);

    setFiles(selected);
    setOcrResults([]);
    setProgress(0);
    setStatusText("");
    setError("");
  }

  async function analyzeImages() {
    if (files.length === 0 || isAnalyzing) return;

    setIsAnalyzing(true);
    setProgress(0);
    setError("");
    setOcrResults([]);
    setStatusText("OCRエンジンを準備しています…");

    let worker;

    try {
      worker = await createWorker("jpn", 1, {
        logger: (message) => {
          if (message.status === "recognizing text") {
            const current = Math.round((message.progress || 0) * 100);
            setProgress(current);
            setStatusText(`文字を認識しています… ${current}%`);
          }
        },
      });

      const results = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        setProgress(0);
        setStatusText(
          `${i + 1}/${files.length}枚目を解析しています…`
        );

        const result = await worker.recognize(file);

        results.push({
          fileName: file.name,
          text: result.data.text || "",
        });
      }

      setOcrResults(results);
      setProgress(100);
      setStatusText("解析が完了しました");
    } catch (e) {
      console.error(e);
      setError(
        "OCR解析中にエラーが発生しました。通信状態を確認して、もう一度お試しください。"
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
            <p>診療日別集計表 → Excel</p>
          </div>
        </header>

        <div className="privacy">
          🔒 画像・診療データはサーバーに保存されません
        </div>

        <section className="card">
          <h2>診療実績を読み込む</h2>

          <p className="description">
            診療日別集計表のスクリーンショットを選択してください。
            複数の画像をまとめて選択できます。
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
            onClick={() => inputRef.current?.click()}
            disabled={isAnalyzing}
          >
            ＋ スクリーンショットを選択
          </button>

          {files.length > 0 && (
            <div className="selected">
              <strong>{files.length}枚</strong>の画像を選択しました

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
          <h2>OCR解析</h2>

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
              : "画像を解析"}
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

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </section>

        {ocrResults.length > 0 && (
          <section className="card">
            <span className="step">STEP 3</span>
            <h2>OCR読み取り結果</h2>

            <p className="description">
              まずは文字が正しく認識されているか確認します。
            </p>

            {ocrResults.map((result, index) => (
              <div
                className="ocr-result"
                key={`${result.fileName}-${index}`}
              >
                <strong>{result.fileName}</strong>

                <pre>{result.text}</pre>
              </div>
            ))}
          </section>
        )}

        <footer>
          診療画像はこの端末内でOCR処理します
        </footer>
      </section>
    </main>
  );
}