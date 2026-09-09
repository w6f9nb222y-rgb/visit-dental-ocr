import { useRef, useState } from "react";

export default function App() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  const [row1Center, setRow1Center] = useState(0.055);
  const [rowStep, setRowStep] = useState(0.0267);

  const inputRef = useRef(null);

  const sampleDays = [7, 14, 21, 28];

  const columns = [
    {
      key: "patients",
      label: "実患者",
      x: 0.425,
      w: 0.045,
    },
    {
      key: "insurance",
      label: "保険診療分",
      x: 0.485,
      w: 0.085,
    },
    {
      key: "care",
      label: "介護保険",
      x: 0.720,
      w: 0.095,
    },
  ];

  function handleFiles(event) {
    const selected = Array.from(event.target.files || []);

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
        reject(new Error("画像を読み込めませんでした"));
      };

      image.src = url;
    });
  }

  function createSingleCellPreview(image, day, column) {
    const centerY =
      image.height * (row1Center + (day - 1) * rowStep);

    const rowHeight =
      image.height * rowStep * 0.72;

    const sourceY = centerY - rowHeight / 2;

    const sourceX = image.width * column.x;
    const sourceWidth = image.width * column.w;

    const scale = 3;

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(
      120,
      Math.floor(sourceWidth * scale)
    );

    canvas.height = Math.max(
      60,
      Math.floor(rowHeight * scale)
    );

    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      rowHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas.toDataURL("image/jpeg", 0.95);
  }

  async function makePreviews() {
    if (files.length === 0) return;

    setIsProcessing(true);
    setError("");
    setPreviews([]);

    try {
      const output = [];

      for (const file of files) {
        const image = await loadImage(file);

        const rows = sampleDays.map((day) => {
          const cells = columns.map((column) => ({
            key: column.key,
            label: column.label,
            imageUrl: createSingleCellPreview(
              image,
              day,
              column
            ),
          }));

          return {
            day,
            cells,
          };
        });

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
      setError("切り抜き確認画像の作成に失敗しました。");
    } finally {
      setIsProcessing(false);
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
            今回は7・14・21・28日の4日だけ確認します。
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
            onClick={() => inputRef.current?.click()}
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
          <span className="step">STEP 2</span>
          <h2>行位置を調整</h2>

          <div style={{ marginTop: "18px" }}>
            <label
              style={{
                display: "block",
                fontWeight: 700,
                marginBottom: "8px",
              }}
            >
              1日目の位置：{row1Center.toFixed(4)}
            </label>

            <input
              type="range"
              min="0.040"
              max="0.075"
              step="0.0005"
              value={row1Center}
              onChange={(event) =>
                setRow1Center(Number(event.target.value))
              }
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ marginTop: "24px" }}>
            <label
              style={{
                display: "block",
                fontWeight: 700,
                marginBottom: "8px",
              }}
            >
              行間隔：{rowStep.toFixed(4)}
            </label>

            <input
              type="range"
              min="0.0220"
              max="0.0320"
              step="0.0002"
              value={rowStep}
              onChange={(event) =>
                setRowStep(Number(event.target.value))
              }
              style={{ width: "100%" }}
            />
          </div>

          <button
            className={
              files.length > 0
                ? "select-button"
                : "disabled-button"
            }
            disabled={files.length === 0 || isProcessing}
            onClick={makePreviews}
            style={{ marginTop: "26px" }}
          >
            {isProcessing
              ? "作成中…"
              : "4日分を確認"}
          </button>

          <p
            style={{
              margin: "14px 0 0",
              color: "#64748b",
              fontSize: "12px",
              lineHeight: 1.6,
            }}
          >
            7日は合っていて28日がズレる場合は、
            「行間隔」を調整してください。
          </p>

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
            <h2>4日×3列の切り抜き確認</h2>

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
              元画像：{item.width} × {item.height}
            </div>

            {item.rows.map((row) => (
              <div
                key={row.day}
                style={{
                  marginBottom: "30px",
                }}
              >
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: 800,
                    marginBottom: "10px",
                  }}
                >
                  {row.day}日
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(3, minmax(0, 1fr))",
                    gap: "10px",
                  }}
                >
                  {row.cells.map((cell) => (
                    <div key={cell.key}>
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          marginBottom: "6px",
                          textAlign: "center",
                        }}
                      >
                        {cell.label}
                      </div>

                      <div
                        style={{
                          border: "1px solid #cbd5e1",
                          borderRadius: "10px",
                          background: "#f8fafc",
                          padding: "6px",
                          minHeight: "86px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        <img
                          src={cell.imageUrl}
                          alt={`${row.day}日 ${cell.label}`}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "74px",
                            objectFit: "contain",
                            display: "block",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}

        <footer>
          4日分が合えば、次は1日単位OCRへ進みます
        </footer>
      </section>
    </main>
  );
}