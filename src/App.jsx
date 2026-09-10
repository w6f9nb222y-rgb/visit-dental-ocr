import { useRef, useState } from "react";

export default function App() {
  const [file, setFile] = useState(null);
  const [image, setImage] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * 昨日まで使用していた座標
   */
  const ROW_1_CENTER = 0.0550;
  const ROW_STEP = 0.0267;

  /*
   * 今回は診療日判定しやすい
   * 「保険診療分」を広めに表示
   */
  const INSURANCE = {
    x: 0.520,
    w: 0.090,
  };

  async function handleFile(event) {
    const selected =
      event.target.files?.[0];

    if (!selected) return;

    setFile(selected);
    setRows([]);
    setError("");

    try {
      const loaded =
        await loadImage(selected);

      setImage(loaded);
    } catch (e) {
      setError(
        "画像を読み込めませんでした"
      );
    }
  }

  function loadImage(file) {
    return new Promise(
      (resolve, reject) => {
        const img =
          new Image();

        const url =
          URL.createObjectURL(file);

        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(
            new Error(
              "画像読込エラー"
            )
          );
        };

        img.src = url;
      }
    );
  }

  /*
   * 1日の保険診療分付近を切り出す
   */
  function makePreview(
    image,
    day
  ) {
    const centerY =
      image.height *
      (
        ROW_1_CENTER +
        (day - 1) *
          ROW_STEP
      );

    /*
     * 行の高さをかなり広めにして、
     * 上下ズレも確認できるようにする
     */
    const sourceHeight =
      image.height *
      ROW_STEP *
      0.90;

    const sourceY =
      centerY -
      sourceHeight / 2;

    const sourceX =
      image.width *
      INSURANCE.x;

    const sourceWidth =
      image.width *
      INSURANCE.w;

    const canvas =
      document.createElement(
        "canvas"
      );

    /*
     * 表示確認用なので拡大
     */
    canvas.width = 420;
    canvas.height = 90;

    const ctx =
      canvas.getContext("2d");

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      "high";

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

    return canvas.toDataURL(
      "image/jpeg",
      0.9
    );
  }

  function createPreviews() {
    if (!image) return;

    const output = [];

    for (
      let day = 1;
      day <= 31;
      day++
    ) {
      output.push({
        day,
        preview:
          makePreview(
            image,
            day
          ),
      });
    }

    setRows(output);
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
              行位置確認テスト
            </p>
          </div>
        </header>

        <div className="privacy">
          🔒 画像は端末内だけで処理します
        </div>

        <section className="card">

          <span className="step">
            STEP 1
          </span>

          <h2>
            画像を選択
          </h2>

          <p className="description">
            まず31日分の行位置が
            正しいか確認します。
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
            onClick={() =>
              inputRef.current?.click()
            }
          >
            ＋画像を選択
          </button>

          {file && (
            <div className="selected">
              {file.name}
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

        </section>

        {image && (
          <section className="card">

            <span className="step">
              STEP 2
            </span>

            <h2>
              31日分の行を表示
            </h2>

            <button
              className="select-button"
              onClick={
                createPreviews
              }
            >
              行位置を確認
            </button>

          </section>
        )}

        {rows.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              保険診療分の切り抜き
            </h2>

            <p className="description">
              特に
              7・12・14・19・21・26・28日
              を確認してください。
            </p>

            {rows.map(
              (row) => (
                <div
                  key={row.day}
                  style={{
                    display:
                      "flex",

                    alignItems:
                      "center",

                    gap: "12px",

                    marginBottom:
                      "8px",

                    padding:
                      "6px",

                    background:
                      [
                        7,
                        12,
                        14,
                        19,
                        21,
                        26,
                        28,
                      ].includes(
                        row.day
                      )
                        ? "#fff7cc"
                        : "#fff",

                    border:
                      "1px solid #e2e8f0",

                    borderRadius:
                      "8px",
                  }}
                >

                  <div
                    style={{
                      width:
                        "36px",

                      flexShrink:
                        0,

                      fontWeight:
                        700,

                      textAlign:
                        "center",
                    }}
                  >
                    {row.day}
                  </div>

                  <img
                    src={
                      row.preview
                    }
                    alt=""
                    style={{
                      width:
                        "calc(100% - 48px)",

                      height:
                        "54px",

                      objectFit:
                        "contain",

                      background:
                        "#fff",
                    }}
                  />

                </div>
              )
            )}

          </section>
        )}

        <footer>
          行位置キャリブレーション
        </footer>

      </section>
    </main>
  );
}