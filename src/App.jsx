import { useRef, useState } from "react";

export default function App() {
  const [files, setFiles] = useState([]);
  const inputRef = useRef(null);

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
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
          >
            ＋ スクリーンショットを選択
          </button>

          {files.length > 0 && (
            <div className="selected">
              <strong>{files.length}枚</strong>の画像を選択しました
              <ul>
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>{file.name}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card disabled-card">
          <div>
            <span className="step">STEP 2</span>
            <h2>OCR解析</h2>
          </div>
          <button className="disabled-button" disabled>
            画像を解析
          </button>
        </section>

        <footer>
          診療データはこの端末内だけで処理します
        </footer>
      </section>
    </main>
  );
}