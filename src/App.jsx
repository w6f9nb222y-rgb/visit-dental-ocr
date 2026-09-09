import { useRef, useState } from "react";

export default function App() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
    setPreviews([]);
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

          const canvas = document.createElement("canvas");

          // プレビューは見やすいよう約1.5倍
          const scale = 1.5;

          canvas.width = Math.floor(sw * scale);
          canvas.height = Math.floor(sh * scale);

          const ctx = canvas.getContext("2d");

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

          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);

              if (!blob) {
                reject(new Error("画像の切り抜きに失敗しました"));
                return;
              }

              resolve(URL.createObjectURL(blob));
            },
            "image/jpeg",
            0.92
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

  async function makePreviews() {
    if (files.length === 0) return;

    setError("");
    setPreviews([]);

    try {
      const output = [];

      /*
        IMG_5412.jpeg の帳票レイアウトを基準にした
        画面幅・高さに対する割合です。

        次の画面で位置を目視確認して、
        必要なら微調整します。
      */
      const crops = [
  {
    key: "patients",
    label: "実患者",
    x: 0.410,
    y: 0.035,
    w: 0.050,
    h: 0.755,
  },
  {
    key: "insurance",
    label: "保険診療分（点数）",
    x: 0.490,
    y: 0.035,
    w: 0.075,
    h: 0.755,
  },
  {
    key: "care",
    label: "その他保険診療分（介護保険・点数）",
    x: 0.710,
    y: 0.035,
    w: 0.070,
    h: 0.755,
  },
];

      for (const file of files) {
        const cropResults = [];

        for (const crop of crops) {
          const imageUrl = await cropImage(file, crop);

          cropResults.push({
            ...crop,
            imageUrl,
          });
        }

        output.push({
          fileName: file.name,
          crops: cropResults,
        });
      }

      setPreviews(output);
    } catch (e) {
      console.error(e);
      setError("切り抜き処理に失敗しました。");
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

          <p className="description">
            今回はOCRせず、必要な列の切り抜き位置だけ確認します。
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
              <strong>{files.length}枚</strong>選択しました

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

        <section className="card">
          <span className="step">STEP 2</span>
          <h2>必要列を切り抜く</h2>

          <button
            className={
              files.length > 0
                ? "select-button"
                : "disabled-button"
            }
            disabled={files.length === 0}
            onClick={makePreviews}
          >
            切り抜き位置を確認
          </button>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </section>

        {previews.map((item, fileIndex) => (
          <section
            className="card"
            key={`${item.fileName}-${fileIndex}`}
          >
            <span className="step">STEP 3</span>
            <h2>切り抜き確認</h2>

            <p className="description">
              この3列だけを最終的にOCRします。
            </p>

            <strong>{item.fileName}</strong>

            {item.crops.map((crop) => (
              <div
                key={crop.key}
                style={{ marginTop: "24px" }}
              >
                <h3
                  style={{
                    margin: "0 0 10px",
                    fontSize: "16px",
                  }}
                >
                  {crop.label}
                </h3>

                <img
                  src={crop.imageUrl}
                  alt={crop.label}
                  style={{
                    width: "100%",
                    maxHeight: "650px",
                    objectFit: "contain",
                    objectPosition: "left top",
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: "12px",
                  }}
                />
              </div>
            ))}
          </section>
        ))}

        <footer>
          次の段階で、この3列だけ数字OCRします
        </footer>
      </section>
    </main>
  );
}