import { useRef, useState } from "react";

export default function App() {
  const [file, setFile] = useState(null);
  const [imageUrl, setImageUrl] = useState("");

  const [patients, setPatients] = useState({
    x: 0.408,
    w: 0.028,
  });

  const [insurance, setInsurance] = useState({
    x: 0.492,
    w: 0.055,
  });

  const [care, setCare] = useState({
    x: 0.726,
    w: 0.060,
  });

  const inputRef = useRef(null);

  function handleFile(event) {
    const selected =
      event.target.files?.[0];

    if (!selected) return;

    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }

    setFile(selected);
    setImageUrl(
      URL.createObjectURL(selected)
    );
  }

  function percent(value) {
    return `${value * 100}%`;
  }

  function ColumnSlider({
    title,
    value,
    setValue,
    className,
  }) {
    return (
      <div
        style={{
          marginBottom: "28px",
          padding: "16px",
          background: "#f8fafc",
          borderRadius: "14px",
        }}
      >
        <h3
          style={{
            margin: "0 0 16px",
            fontSize: "17px",
          }}
        >
          {title}
        </h3>

        <label
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: 700,
            marginBottom: "7px",
          }}
        >
          左端 X：
          {value.x.toFixed(4)}
        </label>

        <input
          type="range"
          min="0.30"
          max="0.85"
          step="0.001"
          value={value.x}
          onChange={(event) =>
            setValue({
              ...value,
              x: Number(
                event.target.value
              ),
            })
          }
          style={{
            width: "100%",
          }}
        />

        <label
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: 700,
            marginTop: "18px",
            marginBottom: "7px",
          }}
        >
          横幅 W：
          {value.w.toFixed(4)}
        </label>

        <input
          type="range"
          min="0.015"
          max="0.120"
          step="0.001"
          value={value.w}
          onChange={(event) =>
            setValue({
              ...value,
              w: Number(
                event.target.value
              ),
            })
          }
          style={{
            width: "100%",
          }}
        />

        <div
          className={className}
          style={{
            marginTop: "12px",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          X {value.x.toFixed(4)}
          {" / "}
          W {value.w.toFixed(4)}
        </div>
      </div>
    );
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
          画像・診療データは
          サーバーに保存されません
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
            元画像の上で3列の位置を
            正確に合わせます。
          </p>

          <input
            ref={inputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            onChange={handleFile}
          />

          <button
            className="select-button"
            onClick={() =>
              inputRef.current?.click()
            }
          >
            ＋ スクリーンショットを選択
          </button>

          {file && (
            <div className="selected">
              {file.name}
            </div>
          )}
        </section>

        {imageUrl && (
          <>
            <section className="card">
              <span className="step">
                STEP 2
              </span>

              <h2>
                列位置を目視確認
              </h2>

              <p className="description">
                赤＝実患者、
                青＝保険診療分、
                緑＝介護保険です。
                横スクロールできます。
              </p>

              <div
                style={{
                  overflowX: "auto",
                  border:
                    "1px solid #cbd5e1",
                  borderRadius:
                    "12px",
                  background:
                    "#f8fafc",
                  padding: "6px",
                }}
              >
                <div
                  style={{
                    position:
                      "relative",
                    width: "180%",
                    lineHeight: 0,
                  }}
                >
                  <img
                    src={imageUrl}
                    alt="元画像"
                    style={{
                      width: "100%",
                      height: "auto",
                      display:
                        "block",
                    }}
                  />

                  <div
                    style={{
                      position:
                        "absolute",
                      left: percent(
                        patients.x
                      ),
                      width: percent(
                        patients.w
                      ),
                      top: "3%",
                      height: "80%",
                      border:
                        "3px solid #ef4444",
                      background:
                        "rgba(239,68,68,0.18)",
                      boxSizing:
                        "border-box",
                    }}
                  >
                    <div
                      style={{
                        position:
                          "absolute",
                        top: "0",
                        left: "0",
                        background:
                          "#ef4444",
                        color: "white",
                        fontSize:
                          "11px",
                        lineHeight:
                          "1.2",
                        padding:
                          "3px",
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      実患者
                    </div>
                  </div>

                  <div
                    style={{
                      position:
                        "absolute",
                      left: percent(
                        insurance.x
                      ),
                      width: percent(
                        insurance.w
                      ),
                      top: "3%",
                      height: "80%",
                      border:
                        "3px solid #2563eb",
                      background:
                        "rgba(37,99,235,0.18)",
                      boxSizing:
                        "border-box",
                    }}
                  >
                    <div
                      style={{
                        position:
                          "absolute",
                        top: "0",
                        left: "0",
                        background:
                          "#2563eb",
                        color: "white",
                        fontSize:
                          "11px",
                        lineHeight:
                          "1.2",
                        padding:
                          "3px",
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      保険
                    </div>
                  </div>

                  <div
                    style={{
                      position:
                        "absolute",
                      left: percent(
                        care.x
                      ),
                      width: percent(
                        care.w
                      ),
                      top: "3%",
                      height: "80%",
                      border:
                        "3px solid #16a34a",
                      background:
                        "rgba(22,163,74,0.18)",
                      boxSizing:
                        "border-box",
                    }}
                  >
                    <div
                      style={{
                        position:
                          "absolute",
                        top: "0",
                        left: "0",
                        background:
                          "#16a34a",
                        color: "white",
                        fontSize:
                          "11px",
                        lineHeight:
                          "1.2",
                        padding:
                          "3px",
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      介護
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="card">
              <span className="step">
                STEP 3
              </span>

              <h2>
                位置を調整
              </h2>

              <p className="description">
                各色枠が対象の数字列だけを
                囲むように調整してください。
                変更はすぐ上の画像に反映されます。
              </p>

              <ColumnSlider
                title="🔴 実患者"
                value={patients}
                setValue={
                  setPatients
                }
              />

              <ColumnSlider
                title="🔵 保険診療分"
                value={insurance}
                setValue={
                  setInsurance
                }
              />

              <ColumnSlider
                title="🟢 介護保険"
                value={care}
                setValue={setCare}
              />

              <div
                style={{
                  marginTop: "20px",
                  padding: "16px",
                  border:
                    "1px solid #cbd5e1",
                  borderRadius:
                    "12px",
                  background:
                    "#f8fafc",
                  fontFamily:
                    "monospace",
                  fontSize:
                    "13px",
                  lineHeight: 1.8,
                }}
              >
                <strong>
                  現在の座標
                </strong>

                <br />

                実患者：
                x=
                {patients.x.toFixed(
                  4
                )}
                {" / "}
                w=
                {patients.w.toFixed(
                  4
                )}

                <br />

                保険：
                x=
                {insurance.x.toFixed(
                  4
                )}
                {" / "}
                w=
                {insurance.w.toFixed(
                  4
                )}

                <br />

                介護：
                x=
                {care.x.toFixed(
                  4
                )}
                {" / "}
                w=
                {care.w.toFixed(
                  4
                )}
              </div>

              <p
                style={{
                  margin:
                    "16px 0 0",
                  color:
                    "#64748b",
                  fontSize:
                    "13px",
                  lineHeight: 1.6,
                }}
              >
                合わせ終わったら、
                この「現在の座標」が
                見えるスクリーンショットを
                送ってください。
              </p>
            </section>
          </>
        )}

        <footer>
          横位置確定後、
          1日単位OCRへ進みます
        </footer>
      </section>
    </main>
  );
}