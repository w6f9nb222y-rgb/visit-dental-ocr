import { useRef, useState } from "react";

export default function App() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  /*
    画像全体に対する割合。

    row1Center:
      1日目の行の中心位置

    rowStep:
      1日進むごとの縦方向の間隔
  */
  const [row1Center, setRow1Center] = useState(0.055);
  const [rowStep, setRowStep] = useState(0.0267);

  const inputRef = useRef(null);

  /*
    今回確認したい代表日。

    実データが入っている日を選んでいるので、
    位置が正しければ数字を目視しやすい。
  */
  const sampleDays = [
    7,
    12,
    14,
    19,
    21,
    26,
    28,
  ];

  /*
    横方向は、これまで確認した位置を使用。
  */
  const columns = [
    {
      key: "patients",
      label: "実患者",
      x: 0.438,
      w: 0.030,
    },
    {
      key: "insurance",
      label: "保険診療分",
      x: 0.495,
      w: 0.055,
    },
    {
      key: "care",
      label: "介護保険",
      x: 0.735,
      w: 0.060,
    },
  ];

  function handleFiles(event) {
    const selected = Array.from(
      event.target.files || []
    );

    setFiles(selected);
    setPreviews([]);
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

  function createDayPreview(image, day) {
    /*
      対象日の中心位置。
    */
    const centerY =
      image.height *
      (
        row1Center +
        (day - 1) * rowStep
      );

    /*
      1行分だけ切り出す。

      行間隔の約72%を使い、
      上下の隣接行をなるべく入れない。
    */
    const rowHeight =
      image.height *
      rowStep *
      0.72;

    const sourceY =
      centerY - rowHeight / 2;

    /*
      3セルを横に並べた確認画像を作る。
    */
    const scale = 3;

    const gap = 18;

    const widths = columns.map(
      (column) =>
        Math.floor(
          image.width *
          column.w *
          scale
        )
    );

    const outputHeight =
      Math.max(
        45,
        Math.floor(
          rowHeight * scale
        )
      );

    const outputWidth =
      widths.reduce(
        (sum, value) => sum + value,
        0
      ) +
      gap * (columns.length - 1);

    const canvas =
      document.createElement("canvas");

    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const ctx =
      canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    let destinationX = 0;

    columns.forEach(
      (column, index) => {
        const sourceX =
          image.width * column.x;

        const sourceWidth =
          image.width * column.w;

        const destinationWidth =
          widths[index];

        ctx.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          rowHeight,
          destinationX,
          0,
          destinationWidth,
          outputHeight
        );

        destinationX +=
          destinationWidth + gap;
      }
    );

    return canvas.toDataURL(
      "image/jpeg",
      0.95
    );
  }

  async function makePreviews() {
    if (files.length === 0) {
      return;
    }

    setIsProcessing(true);
    setError("");
    setPreviews([]);

    try {
      const output = [];

      for (
        let fileIndex = 0;
        fileIndex < files.length;
        fileIndex++
      ) {
        const file = files[fileIndex];

        const image =
          await loadImage(file);

        const rows =
          sampleDays.map((day) => ({
            day,
            imageUrl:
              createDayPreview(
                image,
                day
              ),
          }));

        output.push({
          fileName: file.name,
          width: image.width,
          height: image.height,
          rows,
        });
      }

      setPreviews(output);
    } catch (e) {
      console.error(e);

      setError(
        "切り抜き確認画像の作成に失敗しました。"
      );
    } finally {
      setIsProcessing(false);
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
          画像・診療データはサーバーに保存されません
        </div>

        <section className="card">
          <span className="step">
            STEP 1
          </span>

          <h2>
            スクリーンショットを選択
          </h2>

          <p className="description">
            今回はOCRせず、
            1日ごとの行位置だけ確認します。
          </p>

          <input
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={handleFiles}
          />

          <button
            className="select-button"
            disabled={isProcessing}
            onClick={() =>
              inputRef.current?.click()
            }
          >
            ＋ スクリーンショットを選択
          </button>

          {files.length > 0 && (
            <div className="selected">
              {files[0].name}
            </div>
          )}
        </section>

        <section className="card">
          <span className="step">
            STEP 2
          </span>

          <h2>
            行位置を調整
          </h2>

          <p className="description">
            まず初期値のまま確認してください。
            ズレている場合だけスライダーを調整します。
          </p>

          <div
            style={{
              marginTop: "20px",
            }}
          >
            <label
              style={{
                display: "block",
                fontWeight: 700,
                marginBottom: "8px",
              }}
            >
              1日目の位置：
              {row1Center.toFixed(4)}
            </label>

            <input
              type="range"
              min="0.040"
              max="0.075"
              step="0.0005"
              value={row1Center}
              onChange={(event) =>
                setRow1Center(
                  Number(
                    event.target.value
                  )
                )
              }
              style={{
                width: "100%",
              }}
            />
          </div>

          <div
            style={{
              marginTop: "24px",
            }}
          >
            <label
              style={{
                display: "block",
                fontWeight: 700,
                marginBottom: "8px",
              }}
            >
              行間隔：
              {rowStep.toFixed(4)}
            </label>

            <input
              type="range"
              min="0.0220"
              max="0.0320"
              step="0.0002"
              value={rowStep}
              onChange={(event) =>
                setRowStep(
                  Number(
                    event.target.value
                  )
                )
              }
              style={{
                width: "100%",
              }}
            />
          </div>

          <button
            className={
              files.length > 0
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              files.length === 0 ||
              isProcessing
            }
            onClick={makePreviews}
            style={{
              marginTop: "26px",
            }}
          >
            {isProcessing
              ? "作成中…"
              : "行位置を確認"}
          </button>

          <p
            style={{
              margin:
                "14px 0 0",
              color: "#64748b",
              fontSize: "12px",
              lineHeight: 1.6,
            }}
          >
            スライダーを変更したら、
            もう一度「行位置を確認」を押してください。
          </p>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </section>

        {previews.map(
          (item, fileIndex) => (
            <section
              className="card"
              key={`${item.fileName}-${fileIndex}`}
            >
              <span className="step">
                STEP 3
              </span>

              <h2>
                1日単位の切り抜き確認
              </h2>

              <p className="description">
                左から
                「実患者 / 保険診療分 /
                介護保険」です。
              </p>

              <div
                style={{
                  marginBottom: "18px",
                  padding: "10px",
                  background: "#f8fafc",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: "#64748b",
                }}
              >
                元画像：
                {item.width}
                ×
                {item.height}
              </div>

              {item.rows.map(
                (row) => (
                  <div
                    key={row.day}
                    style={{
                      marginBottom:
                        "24px",
                    }}
                  >
                    <div
                      style={{
                        fontSize:
                          "17px",
                        fontWeight:
                          800,
                        marginBottom:
                          "8px",
                      }}
                    >
                      {row.day}日
                    </div>

                    <div
                      style={{
                        padding:
                          "10px",
                        background:
                          "#f8fafc",
                        border:
                          "1px solid #cbd5e1",
                        borderRadius:
                          "12px",
                        overflowX:
                          "auto",
                      }}
                    >
                      <img
                        src={
                          row.imageUrl
                        }
                        alt={`${row.day}日`}
                        style={{
                          display:
                            "block",
                          maxWidth:
                            "none",
                          height:
                            "72px",
                          width:
                            "auto",
                        }}
                      />
                    </div>
                  </div>
                )
              )}
            </section>
          )
        )}

        <footer>
          行位置が決まったら、
          次に1日単位OCRへ進みます
        </footer>
      </section>
    </main>
  );
}