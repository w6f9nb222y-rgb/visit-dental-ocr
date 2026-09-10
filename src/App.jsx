import { useRef, useState } from "react";

export default function App() {
  const [file, setFile] = useState(null);
  const [image, setImage] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * ==========================================
   * 横方向はかなり合っているので固定
   * ==========================================
   */

  const INSURANCE = {
    x: 0.520,
    w: 0.090,
  };

  /*
   * ==========================================
   * 縦方向
   *
   * 1日目と31日目の中心位置を基準に
   * その間を30等分する
   *
   * まずは昨日の画像用の初期値
   * ==========================================
   */

  const [row1Center, setRow1Center] =
    useState(0.0545);

  const [row31Center, setRow31Center] =
    useState(0.8450);

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
   * ==========================================
   * 日付ごとの中心Yを計算
   * ==========================================
   */

  function getRowCenter(day) {
    const t =
      (day - 1) / 30;

    return (
      row1Center +
      (
        row31Center -
        row1Center
      ) *
        t
    );
  }

  /*
   * ==========================================
   * プレビュー生成
   * ==========================================
   */

  function makePreview(
    image,
    day
  ) {
    const centerRatio =
      getRowCenter(day);

    /*
     * 31行の平均高さ
     */
    const rowStep =
      (
        row31Center -
        row1Center
      ) / 30;

    const centerY =
      image.height *
      centerRatio;

    const sourceHeight =
      image.height *
      rowStep *
      0.78;

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
      0.92
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
        center:
          getRowCenter(day),
        preview:
          makePreview(
            image,
            day
          ),
      });
    }

    setRows(output);
  }

  function adjustRow1(delta) {
    setRow1Center(
      (current) =>
        Number(
          (
            current +
            delta
          ).toFixed(4)
        )
    );
  }

  function adjustRow31(delta) {
    setRow31Center(
      (current) =>
        Number(
          (
            current +
            delta
          ).toFixed(4)
        )
    );
  }

  const targetDays = [
    7,
    12,
    14,
    19,
    21,
    26,
    28,
  ];

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
              縦位置補正テスト
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
              1日目と31日目を調整
            </h2>

            <p className="description">
              上側と下側を別々に調整します。
              これで途中の行も自動的に再配置されます。
            </p>

            <div
              style={{
                marginBottom:
                  "18px",
              }}
            >
              <strong>
                1日目中心：
                {row1Center.toFixed(4)}
              </strong>

              <div
                style={{
                  display:
                    "flex",
                  gap:
                    "8px",
                  marginTop:
                    "8px",
                }}
              >
                <button
                  onClick={() =>
                    adjustRow1(
                      -0.0010
                    )
                  }
                  style={smallButton}
                >
                  ↑ 大
                </button>

                <button
                  onClick={() =>
                    adjustRow1(
                      -0.0002
                    )
                  }
                  style={smallButton}
                >
                  ↑ 微
                </button>

                <button
                  onClick={() =>
                    adjustRow1(
                      0.0002
                    )
                  }
                  style={smallButton}
                >
                  ↓ 微
                </button>

                <button
                  onClick={() =>
                    adjustRow1(
                      0.0010
                    )
                  }
                  style={smallButton}
                >
                  ↓ 大
                </button>
              </div>
            </div>

            <div
              style={{
                marginBottom:
                  "18px",
              }}
            >
              <strong>
                31日目中心：
                {row31Center.toFixed(4)}
              </strong>

              <div
                style={{
                  display:
                    "flex",
                  gap:
                    "8px",
                  marginTop:
                    "8px",
                }}
              >
                <button
                  onClick={() =>
                    adjustRow31(
                      -0.0010
                    )
                  }
                  style={smallButton}
                >
                  ↑ 大
                </button>

                <button
                  onClick={() =>
                    adjustRow31(
                      -0.0002
                    )
                  }
                  style={smallButton}
                >
                  ↑ 微
                </button>

                <button
                  onClick={() =>
                    adjustRow31(
                      0.0002
                    )
                  }
                  style={smallButton}
                >
                  ↓ 微
                </button>

                <button
                  onClick={() =>
                    adjustRow31(
                      0.0010
                    )
                  }
                  style={smallButton}
                >
                  ↓ 大
                </button>
              </div>
            </div>

            <button
              className="select-button"
              onClick={
                createPreviews
              }
            >
              行位置を再表示
            </button>

          </section>
        )}

        {rows.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              保険診療分プレビュー
            </h2>

            <p className="description">
              黄色の日の数字が
              それぞれ中央付近に来ているか確認します。
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

                    gap:
                      "12px",

                    marginBottom:
                      "8px",

                    padding:
                      "6px",

                    background:
                      targetDays.includes(
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
                        "44px",
                      flexShrink:
                        0,
                      textAlign:
                        "center",
                    }}
                  >
                    <div
                      style={{
                        fontWeight:
                          700,
                      }}
                    >
                      {row.day}
                    </div>

                    <div
                      style={{
                        fontSize:
                          "9px",
                        color:
                          "#94a3b8",
                      }}
                    >
                      {row.center.toFixed(4)}
                    </div>
                  </div>

                  <img
                    src={
                      row.preview
                    }
                    alt=""
                    style={{
                      width:
                        "calc(100% - 56px)",

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
          行位置2点補正版
        </footer>

      </section>
    </main>
  );
}

const smallButton = {
  flex: 1,
  padding: "8px 4px",
  border: "1px solid #cbd5e1",
  background: "#fff",
  borderRadius: "8px",
  fontSize: "12px",
};