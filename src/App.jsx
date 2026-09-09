import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [file, setFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState([]);
  const [elapsed, setElapsed] = useState(null);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
    縦方向。
    これまでの校正で使用した値。
  */
  const ROW_1_CENTER = 0.0550;
  const ROW_STEP = 0.0267;

  /*
    横方向。
    Safari上の目視校正で確定した値。
  */
  const COLUMNS = {
    patients: {
      x: 0.4820,
      w: 0.0300,
      label: "実患者",
    },

    insurance: {
      x: 0.5280,
      w: 0.0700,
      label: "保険診療分",
    },

    care: {
      x: 0.7970,
      w: 0.0600,
      label: "介護保険",
    },
  };

  function handleFile(event) {
    const selected = event.target.files?.[0];

    if (!selected) return;

    setFile(selected);
    setRows([]);
    setElapsed(null);
    setProgress(0);
    setStatusText("");
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

  function clamp(value) {
    return Math.max(
      0,
      Math.min(255, value)
    );
  }

  /*
    1日×1セルだけ切り出す。
  */
  function createCellBlob(
    image,
    day,
    columnKey
  ) {
    return new Promise((resolve, reject) => {
      try {
        const column =
          COLUMNS[columnKey];

        /*
          対象日の中心位置
        */
        const centerY =
          image.height *
          (
            ROW_1_CENTER +
            (day - 1) * ROW_STEP
          );

        /*
          隣の行をなるべく含めない。
          ただし撮影時の少しの傾きには
          対応できるよう若干余裕を持たせる。
        */
        const rowHeight =
          image.height *
          ROW_STEP *
          0.78;

        const sourceY =
          centerY - rowHeight / 2;

        const sourceX =
          image.width * column.x;

        const sourceWidth =
          image.width * column.w;

        /*
          小さい数字なので拡大。
          実患者は細い列なので少し大きめ。
        */
        const scale =
          columnKey === "patients"
            ? 4
            : 3;

        const canvas =
          document.createElement("canvas");

        canvas.width = Math.max(
          180,
          Math.floor(
            sourceWidth * scale
          )
        );

        canvas.height = Math.max(
          100,
          Math.floor(
            rowHeight * scale
          )
        );

        const ctx =
          canvas.getContext("2d", {
            willReadFrequently: true,
          });

        ctx.fillStyle = "#ffffff";

        ctx.fillRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

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

        /*
          モニター撮影画像なので
          強制的な白黒化はしない。

          グレースケール＋軽い
          コントラスト強調だけ行う。
        */
        const imageData =
          ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          );

        const data =
          imageData.data;

        const contrast = 1.45;

        for (
          let i = 0;
          i < data.length;
          i += 4
        ) {
          const gray =
            data[i] * 0.299 +
            data[i + 1] * 0.587 +
            data[i + 2] * 0.114;

          let value =
            (gray - 128) *
              contrast +
            128;

          value = clamp(value);

          /*
            明るい背景はさらに
            少し白側へ寄せる。
          */
          if (value > 185) {
            value = clamp(
              value + 15
            );
          }

          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
          data[i + 3] = 255;
        }

        ctx.putImageData(
          imageData,
          0,
          0
        );

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(
                new Error(
                  "画像変換に失敗しました"
                )
              );

              return;
            }

            resolve(blob);
          },
          "image/png",
          1
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  function extractNumber(text) {
    const cleaned =
      String(text || "")
        .replace(/[^\d]/g, "");

    if (!cleaned) {
      return 0;
    }

    const value =
      Number(cleaned);

    if (!Number.isFinite(value)) {
      return 0;
    }

    return value;
  }

  function formatNumber(value) {
    return Number(value || 0)
      .toLocaleString("ja-JP");
  }

  async function recognizeCell(
    worker,
    image,
    day,
    columnKey
  ) {
    const blob =
      await createCellBlob(
        image,
        day,
        columnKey
      );

    await worker.setParameters({
      tessedit_char_whitelist:
        columnKey === "patients"
          ? "0123456789"
          : "0123456789,",
      tessedit_pageseg_mode: "7",
      preserve_interword_spaces: "0",
      user_defined_dpi: "300",
    });

    const result =
      await worker.recognize(blob);

    const raw =
      String(
        result.data.text || ""
      ).trim();

    return {
      raw,
      value: extractNumber(raw),
    };
  }

  async function analyzeImage() {
    if (!file || isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    setRows([]);
    setElapsed(null);
    setError("");
    setProgress(0);

    const started =
      performance.now();

    let worker;

    try {
      setStatusText(
        "画像を準備しています…"
      );

      const image =
        await loadImage(file);

      setStatusText(
        "OCRエンジンを準備しています…"
      );

      worker =
        await createWorker(
          "eng",
          1
        );

      const activeRows = [];

      /*
        STEP 1

        まず実患者だけ31日読む。

        患者0の日は保険・介護を
        OCRしないので高速化できる。
      */
      for (
        let day = 1;
        day <= 31;
        day++
      ) {
        setStatusText(
          `${day}日：実患者を確認中…`
        );

        setProgress(
          Math.round(
            (day / 31) * 45
          )
        );

        const patientResult =
          await recognizeCell(
            worker,
            image,
            day,
            "patients"
          );

        if (
          patientResult.value > 0
        ) {
          activeRows.push({
            day,
            patients:
              patientResult.value,
            patientsRaw:
              patientResult.raw,
          });
        }
      }

      /*
        STEP 2

        患者がいた日だけ
        保険・介護を読む。
      */
      for (
        let index = 0;
        index < activeRows.length;
        index++
      ) {
        const row =
          activeRows[index];

        setStatusText(
          `${row.day}日：保険診療分を解析中…`
        );

        const insurance =
          await recognizeCell(
            worker,
            image,
            row.day,
            "insurance"
          );

        setStatusText(
          `${row.day}日：介護保険を解析中…`
        );

        const care =
          await recognizeCell(
            worker,
            image,
            row.day,
            "care"
          );

        row.insurance =
          insurance.value;

        row.insuranceRaw =
          insurance.raw;

        row.care =
          care.value;

        row.careRaw =
          care.raw;

        row.total =
          row.insurance +
          row.care;

        /*
          OCR確認用。
          不自然な数字は黄色表示する。
        */
        row.warning =
          row.patients > 99 ||
          row.insurance >
            100000 ||
          row.care >
            100000;

        setProgress(
          45 +
            Math.round(
              (
                (index + 1) /
                Math.max(
                  1,
                  activeRows.length
                )
              ) *
                55
            )
        );
      }

      const finished =
        performance.now();

      setRows(activeRows);

      setElapsed(
        (
          (finished -
            started) /
          1000
        ).toFixed(1)
      );

      setProgress(100);

      setStatusText(
        "解析が完了しました"
      );
    } catch (e) {
      console.error(e);

      setError(
        "OCR解析中にエラーが発生しました。"
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
            校正済み座標を使って、
            1日1セル単位で読み取ります。
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
            disabled={isAnalyzing}
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

        <section className="card">
          <span className="step">
            STEP 2
          </span>

          <h2>
            日別OCR
          </h2>

          <p className="description">
            最初に実患者だけ確認し、
            患者0の日は残りのOCRを
            スキップします。
          </p>

          <button
            className={
              file
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              !file ||
              isAnalyzing
            }
            onClick={
              analyzeImage
            }
          >
            {isAnalyzing
              ? "解析中…"
              : "日別データを解析"}
          </button>

          {statusText && (
            <div className="ocr-status">
              <p>
                {statusText}
              </p>

              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{
                    width:
                      `${progress}%`,
                  }}
                />
              </div>
            </div>
          )}

          {elapsed && (
            <div className="selected">
              解析時間：
              <strong>
                {elapsed}秒
              </strong>
            </div>
          )}

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </section>

        {rows.length > 0 && (
          <section className="card">
            <span className="step">
              STEP 3
            </span>

            <h2>
              日別集計結果
            </h2>

            <p className="description">
              実患者・保険・介護を
              日ごとにまとめました。
            </p>

            <div
              style={{
                overflowX: "auto",
                marginTop: "16px",
              }}
            >
              <table
                style={{
                  width: "100%",
                  minWidth:
                    "570px",
                  borderCollapse:
                    "collapse",
                  fontSize:
                    "13px",
                }}
              >
                <thead>
                  <tr>
                    <th style={cellStyle}>
                      日付
                    </th>

                    <th style={cellStyle}>
                      実患者
                    </th>

                    <th style={cellStyle}>
                      保険診療分
                    </th>

                    <th style={cellStyle}>
                      介護保険
                    </th>

                    <th style={cellStyle}>
                      合計
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map(
                    (row) => (
                      <tr
                        key={
                          row.day
                        }
                        style={{
                          background:
                            row.warning
                              ? "#fef3c7"
                              : "white",
                        }}
                      >
                        <td
                          style={
                            cellStyle
                          }
                        >
                          {row.day}日
                        </td>

                        <td
                          style={
                            numberCellStyle
                          }
                        >
                          {
                            row.patients
                          }
                        </td>

                        <td
                          style={
                            numberCellStyle
                          }
                        >
                          {formatNumber(
                            row.insurance
                          )}
                        </td>

                        <td
                          style={
                            numberCellStyle
                          }
                        >
                          {formatNumber(
                            row.care
                          )}
                        </td>

                        <td
                          style={
                            numberCellStyle
                          }
                        >
                          <strong>
                            {formatNumber(
                              row.total
                            )}
                          </strong>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            <details
              style={{
                marginTop:
                  "20px",
              }}
            >
              <summary
                style={{
                  cursor:
                    "pointer",
                  fontWeight:
                    700,
                }}
              >
                OCR生データを確認
              </summary>

              <div
                style={{
                  marginTop:
                    "12px",
                  fontSize:
                    "12px",
                  lineHeight: 1.7,
                }}
              >
                {rows.map(
                  (row) => (
                    <div
                      key={
                        row.day
                      }
                      style={{
                        padding:
                          "8px 0",
                        borderBottom:
                          "1px solid #e2e8f0",
                      }}
                    >
                      <strong>
                        {row.day}日
                      </strong>

                      <br />

                      患者：
                      {row.patientsRaw ||
                        "(空)"}

                      {" / "}

                      保険：
                      {row.insuranceRaw ||
                        "(空)"}

                      {" / "}

                      介護：
                      {row.careRaw ||
                        "(空)"}
                    </div>
                  )
                )}
              </div>
            </details>
          </section>
        )}

        <footer>
          次は年月・曜日判定と
          Excel出力を追加します
        </footer>
      </section>
    </main>
  );
}

const cellStyle = {
  border:
    "1px solid #cbd5e1",
  padding: "9px",
  whiteSpace: "nowrap",
};

const numberCellStyle = {
  ...cellStyle,
  textAlign: "right",
};