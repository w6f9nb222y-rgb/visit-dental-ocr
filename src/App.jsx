import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [file, setFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState([]);
  const [elapsed, setElapsed] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
    前回、元画像上で目視校正した横座標。
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

  /*
    日付数字「1〜31」がある左側の列。

    この範囲の黒さを調べて
    31行の位置を自動推定する。
  */
  const DATE_COLUMN = {
    x: 0.190,
    w: 0.020,
  };

  function handleFile(event) {
    const selected = event.target.files?.[0];

    if (!selected) return;

    setFile(selected);
    setRows([]);
    setElapsed(null);
    setGeometry(null);
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
    -----------------------------------
    行位置の自動検出
    -----------------------------------

    1日目の中心位置と1日ごとの間隔を
    いろいろ試して、

    「1〜31の日付数字の上を最も正確に通る」
    組み合わせを探す。
  */
  function detectRowGeometry(image) {
    const canvas =
      document.createElement("canvas");

    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    ctx.drawImage(image, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data = imageData.data;

    const xStart = Math.floor(
      image.width * DATE_COLUMN.x
    );

    const xEnd = Math.floor(
      image.width *
        (DATE_COLUMN.x + DATE_COLUMN.w)
    );

    /*
      指定したY周辺にどれくらい
      黒い画素があるかを返す。

      日付数字の中心なら高得点になる。
    */
    function darknessAt(yRatio) {
      const centerY =
        Math.floor(image.height * yRatio);

      const halfHeight =
        Math.max(
          3,
          Math.floor(image.height * 0.005)
        );

      const yStart =
        Math.max(0, centerY - halfHeight);

      const yEnd =
        Math.min(
          image.height - 1,
          centerY + halfHeight
        );

      let darkness = 0;
      let count = 0;

      for (
        let y = yStart;
        y <= yEnd;
        y++
      ) {
        for (
          let x = xStart;
          x <= xEnd;
          x++
        ) {
          const index =
            (y * image.width + x) * 4;

          const gray =
            data[index] * 0.299 +
            data[index + 1] * 0.587 +
            data[index + 2] * 0.114;

          /*
            暗い画素ほど高得点。
          */
          if (gray < 170) {
            darkness +=
              (170 - gray);
          }

          count++;
        }
      }

      return count > 0
        ? darkness / count
        : 0;
    }

    let best = {
      row1: 0.055,
      step: 0.0240,
      score: -Infinity,
    };

    /*
      画像撮影位置が多少変わっても
      対応できる範囲を探索する。
    */
    for (
      let row1 = 0.045;
      row1 <= 0.075;
      row1 += 0.0005
    ) {
      for (
        let step = 0.0215;
        step <= 0.0265;
        step += 0.0001
      ) {
        let score = 0;

        for (
          let day = 1;
          day <= 31;
          day++
        ) {
          const y =
            row1 +
            (day - 1) * step;

          /*
            31日目が画像外なら除外。
          */
          if (y >= 0.90) {
            score = -Infinity;
            break;
          }

          score += darknessAt(y);
        }

        if (score > best.score) {
          best = {
            row1,
            step,
            score,
          };
        }
      }
    }

    return {
      row1: best.row1,
      step: best.step,
      score: best.score,
    };
  }

  /*
    1日×1セルを切り出して
    OCR用画像へ変換する。
  */
  function createCellBlob(
    image,
    day,
    columnKey,
    rowGeometry
  ) {
    return new Promise((resolve, reject) => {
      try {
        const column =
          COLUMNS[columnKey];

        const centerY =
          image.height *
          (
            rowGeometry.row1 +
            (day - 1) *
              rowGeometry.step
          );

        /*
          1行の約70%だけ使用。

          隣の行の数字を
          OCRが拾いにくくする。
        */
        const rowHeight =
          image.height *
          rowGeometry.step *
          0.70;

        const sourceY =
          centerY -
          rowHeight / 2;

        /*
          斜め撮影への余裕として
          横幅を少しだけ増やす。
        */
        let extraWidth = 0;

        if (
          columnKey ===
          "insurance"
        ) {
          extraWidth = 0.006;
        }

        if (
          columnKey === "care"
        ) {
          extraWidth = 0.010;
        }

        const sourceX =
          image.width *
          (
            column.x -
            extraWidth / 2
          );

        const sourceWidth =
          image.width *
          (
            column.w +
            extraWidth
          );

        const scale =
          columnKey === "patients"
            ? 5
            : 4;

        const canvas =
          document.createElement("canvas");

        canvas.width = Math.max(
          200,
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

        ctx.imageSmoothingEnabled =
          true;

        ctx.imageSmoothingQuality =
          "high";

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
          モニター撮影時のモアレを
          完全二値化せずに抑える。
        */
        const imageData =
          ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          );

        const pixels =
          imageData.data;

        const contrast = 1.35;

        for (
          let i = 0;
          i < pixels.length;
          i += 4
        ) {
          const gray =
            pixels[i] * 0.299 +
            pixels[i + 1] * 0.587 +
            pixels[i + 2] * 0.114;

          let value =
            (gray - 128) *
              contrast +
            128;

          value = clamp(value);

          /*
            背景だけ少し明るくする。
          */
          if (value > 190) {
            value =
              clamp(value + 12);
          }

          pixels[i] = value;
          pixels[i + 1] = value;
          pixels[i + 2] = value;
          pixels[i + 3] = 255;
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
    return Number(
      value || 0
    ).toLocaleString("ja-JP");
  }

  async function recognizeCell(
    worker,
    image,
    day,
    columnKey,
    rowGeometry
  ) {
    const blob =
      await createCellBlob(
        image,
        day,
        columnKey,
        rowGeometry
      );

    await worker.setParameters({
      tessedit_char_whitelist:
        columnKey === "patients"
          ? "0123456789"
          : "0123456789,",

      /*
        1セルに1個の数字。
      */
      tessedit_pageseg_mode: "7",

      preserve_interword_spaces:
        "0",

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
    setGeometry(null);
    setError("");
    setProgress(0);

    const started =
      performance.now();

    let worker;

    try {
      setStatusText(
        "画像を読み込んでいます…"
      );

      const image =
        await loadImage(file);

      /*
        STEP 1
        行位置を自動検出。
      */
      setStatusText(
        "1〜31日の行位置を自動検出しています…"
      );

      const rowGeometry =
        detectRowGeometry(image);

      setGeometry(rowGeometry);

      setProgress(10);

      /*
        STEP 2
        OCR準備。
      */
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
        まず実患者だけ読む。
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
          10 +
            Math.round(
              (day / 31) * 40
            )
        );

        const result =
          await recognizeCell(
            worker,
            image,
            day,
            "patients",
            rowGeometry
          );

        /*
          患者数としてあり得そうな
          1〜99だけ採用。

          例えばモアレを904などと
          誤認識した場合は除外する。
        */
        if (
          result.value >= 1 &&
          result.value <= 99
        ) {
          activeRows.push({
            day,
            patients:
              result.value,
            patientsRaw:
              result.raw,
          });
        }
      }

      /*
        患者がいる日だけ
        保険・介護をOCR。
      */
      for (
        let index = 0;
        index <
        activeRows.length;
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
            "insurance",
            rowGeometry
          );

        setStatusText(
          `${row.day}日：介護保険を解析中…`
        );

        const care =
          await recognizeCell(
            worker,
            image,
            row.day,
            "care",
            rowGeometry
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
          通常の今回の帳票から
          明らかに外れた数字は警告。
        */
        row.warning =
          row.insurance === 0 ||
          row.care === 0 ||
          row.insurance >
            50000 ||
          row.care >
            50000;

        setProgress(
          50 +
            Math.round(
              (
                (index + 1) /
                Math.max(
                  activeRows.length,
                  1
                )
              ) *
                50
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
        "解析中にエラーが発生しました。"
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
            日付列から31行の位置を
            自動検出して読み取ります。
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
            自動行検出＋日別OCR
          </h2>

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

          {geometry && (
            <div
              style={{
                marginTop: "14px",
                padding: "12px",
                background:
                  "#f8fafc",
                borderRadius:
                  "10px",
                fontSize:
                  "12px",
                lineHeight: 1.7,
              }}
            >
              <strong>
                自動検出した行位置
              </strong>

              <br />

              1日目：
              {geometry.row1.toFixed(
                4
              )}

              <br />

              行間隔：
              {geometry.step.toFixed(
                4
              )}
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

            <div
              style={{
                overflowX:
                  "auto",
                marginTop:
                  "16px",
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
                  lineHeight: 1.8,
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
                          "9px 0",
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
          日別OCRが安定したら、
          年月・曜日・Excel出力を追加します
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