import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [files, setFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(null);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * -------------------------------------------------------
   * 帳票位置
   * -------------------------------------------------------
   *
   * 横位置は前回スライダーで合わせた値を使用。
   *
   * Y方向は、以前確認できた
   * 7日・14日・21日・28日
   * が等間隔に並んでいることを利用して計算する。
   *
   * 7日付近 ≒ 0.1745
   * 14日付近 ≒ 0.3250
   * 21日付近 ≒ 0.4755
   * 28日付近 ≒ 0.6260
   *
   * → 1日あたり約0.0215
   */

  const columns = {
    patients: {
      label: "実患者",
      x: 0.482,
      w: 0.030,
    },

    insurance: {
      label: "保険診療分",
      x: 0.528,
      w: 0.070,
    },

    care: {
      label: "介護保険",
      x: 0.797,
      w: 0.060,
    },
  };

  /*
   * 7・14・21・28日から求めた固定行位置
   */
  const anchorRows = [
    { day: 7, y: 0.1745 },
    { day: 14, y: 0.3250 },
    { day: 21, y: 0.4755 },
    { day: 28, y: 0.6260 },
  ];

  /*
   * 最小二乗法で
   *
   * y = intercept + slope * (day - 1)
   *
   * を求める。
   */
  function calculateRowModel() {
    const xs = anchorRows.map((row) => row.day - 1);
    const ys = anchorRows.map((row) => row.y);

    const meanX =
      xs.reduce((sum, value) => sum + value, 0) /
      xs.length;

    const meanY =
      ys.reduce((sum, value) => sum + value, 0) /
      ys.length;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < xs.length; i++) {
      numerator +=
        (xs[i] - meanX) *
        (ys[i] - meanY);

      denominator +=
        (xs[i] - meanX) *
        (xs[i] - meanX);
    }

    const slope = numerator / denominator;
    const intercept = meanY - slope * meanX;

    return {
      intercept,
      slope,
    };
  }

  const rowModel = calculateRowModel();

  /*
   * -------------------------------------------------------
   * ファイル選択
   * -------------------------------------------------------
   */

  function handleFiles(event) {
    const selected =
      Array.from(event.target.files || []);

    setFiles(selected);
    setResults([]);
    setElapsed(null);
    setProgress(0);
    setStatusText("");
    setError("");
  }

  /*
   * -------------------------------------------------------
   * 1セル切り抜き
   * -------------------------------------------------------
   */

  function cropCell(file, column, day) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        try {
          /*
           * その日の中央Y座標
           */
          const centerY =
            rowModel.intercept +
            rowModel.slope * (day - 1);

          /*
           * 行間隔の約70%だけ切り抜く。
           * 上下の行が入り込まないようにする。
           */
          const cropHeight =
            rowModel.slope * 0.70;

          const x1 =
            Math.max(0, column.x);

          const x2 =
            Math.min(
              1,
              column.x + column.w
            );

          const y1 =
            Math.max(
              0,
              centerY - cropHeight / 2
            );

          const y2 =
            Math.min(
              1,
              centerY + cropHeight / 2
            );

          const sx =
            Math.floor(img.width * x1);

          const sy =
            Math.floor(img.height * y1);

          const sw =
            Math.max(
              1,
              Math.floor(
                img.width * (x2 - x1)
              )
            );

          const sh =
            Math.max(
              1,
              Math.floor(
                img.height * (y2 - y1)
              )
            );

          /*
           * OCR用に拡大
           */
          const scale = 4;

          const canvas =
            document.createElement("canvas");

          canvas.width =
            Math.floor(sw * scale);

          canvas.height =
            Math.floor(sh * scale);

          const ctx =
            canvas.getContext("2d", {
              willReadFrequently: true,
            });

          /*
           * 白背景
           */
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

          /*
           * グレースケール
           */
          const imageData =
            ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            );

          const data = imageData.data;

          /*
           * 固定2値化ではなく
           * コントラスト強調。
           *
           * モアレの影響を減らしつつ
           * 数字の形を残す。
           */
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
              (gray - 128) * 1.8 + 128;

            value =
              Math.max(
                0,
                Math.min(255, value)
              );

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
              URL.revokeObjectURL(url);

              if (!blob) {
                reject(
                  new Error(
                    "セル画像の作成に失敗しました"
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
          URL.revokeObjectURL(url);
          reject(e);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);

        reject(
          new Error(
            "画像を読み込めませんでした"
          )
        );
      };

      img.src = url;
    });
  }

  /*
   * -------------------------------------------------------
   * OCR結果を数字に変換
   * -------------------------------------------------------
   */

  function normalizeNumber(text) {
    if (!text) return "";

    let value = text
      .replace(/\s/g, "")
      .replace(/[^\d,]/g, "");

    /*
     * カンマだけなら空欄
     */
    if (!/\d/.test(value)) {
      return "";
    }

    /*
     * カンマを除去
     *
     * 11,484 → 11484
     */
    value =
      value.replace(/,/g, "");

    /*
     * 先頭0除去
     * ただし0そのものは残す
     */
    if (/^0+\d+$/.test(value)) {
      value =
        String(
          Number(value)
        );
    }

    return value;
  }

  /*
   * -------------------------------------------------------
   * OCR
   * -------------------------------------------------------
   */

  async function analyzeImages() {
    if (
      files.length === 0 ||
      isAnalyzing
    ) {
      return;
    }

    setIsAnalyzing(true);
    setProgress(0);
    setResults([]);
    setElapsed(null);
    setError("");

    const started =
      performance.now();

    let worker;

    try {
      setStatusText(
        "OCRエンジンを準備しています…"
      );

      worker =
        await createWorker(
          "eng",
          1,
          {
            logger: () => {},
          }
        );

      /*
       * 1セル = 1個の数字
       */
      await worker.setParameters({
        tessedit_char_whitelist:
          "0123456789,",

        tessedit_pageseg_mode:
          "7",

        preserve_interword_spaces:
          "0",
      });

      const output = [];

      const totalCells =
        files.length *
        31 *
        3;

      let completedCells = 0;

      for (
        let fileIndex = 0;
        fileIndex < files.length;
        fileIndex++
      ) {
        const file =
          files[fileIndex];

        const rows = [];

        for (
          let day = 1;
          day <= 31;
          day++
        ) {
          const row = {
            day,
            patients: "",
            insurance: "",
            care: "",
          };

          for (
            const key of [
              "patients",
              "insurance",
              "care",
            ]
          ) {
            const column =
              columns[key];

            setStatusText(
              `${fileIndex + 1}/${files.length}枚目：` +
              `${day}日 ${column.label}`
            );

            const blob =
              await cropCell(
                file,
                column,
                day
              );

            const result =
              await worker.recognize(
                blob
              );

            row[key] =
              normalizeNumber(
                result.data.text
              );

            completedCells++;

            setProgress(
              Math.round(
                (completedCells /
                  totalCells) *
                  100
              )
            );
          }

          rows.push(row);
        }

        output.push({
          fileName: file.name,
          rows,
        });
      }

      const finished =
        performance.now();

      setElapsed(
        (
          (finished - started) /
          1000
        ).toFixed(1)
      );

      setResults(output);
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

  /*
   * -------------------------------------------------------
   * 表示
   * -------------------------------------------------------
   */

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
          🔒 画像・診療データは
          サーバーに保存されません
        </div>

        <section className="card">
          <span className="step">
            STEP 1
          </span>

          <h2>
            スクリーンショットを選択
          </h2>

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
            disabled={isAnalyzing}
            onClick={() =>
              inputRef.current?.click()
            }
          >
            ＋ スクリーンショットを選択
          </button>

          {files.length > 0 && (
            <div className="selected">
              <strong>
                {files.length}枚
              </strong>
              選択しました
            </div>
          )}
        </section>

        <section className="card">

          <span className="step">
            STEP 2
          </span>

          <h2>
            日別データを解析
          </h2>

          <p className="description">
            1〜31日を1セルずつ読み取ります。
          </p>

          <button
            className={
              files.length > 0
                ? "select-button"
                : "disabled-button"
            }
            disabled={
              files.length === 0 ||
              isAnalyzing
            }
            onClick={analyzeImages}
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

        {results.map(
          (result, resultIndex) => (

            <section
              className="card"
              key={
                `${result.fileName}-${resultIndex}`
              }
            >

              <span className="step">
                STEP 3
              </span>

              <h2>
                日別集計結果
              </h2>

              <p className="description">
                {result.fileName}
              </p>

              <div
                style={{
                  overflowX: "auto",
                }}
              >

                <table
                  style={{
                    width: "100%",
                    borderCollapse:
                      "collapse",
                    minWidth: "650px",
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

                    {result.rows.map(
                      (row) => {

                        const patient =
                          Number(
                            row.patients ||
                              0
                          );

                        const insurance =
                          Number(
                            row.insurance ||
                              0
                          );

                        const care =
                          Number(
                            row.care ||
                              0
                          );

                        const total =
                          insurance +
                          care;

                        const hasData =
                          patient > 0 ||
                          insurance > 0 ||
                          care > 0;

                        if (!hasData) {
                          return null;
                        }

                        return (
                          <tr
                            key={row.day}
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
                              {row.patients ||
                                ""}
                            </td>

                            <td
                              style={
                                numberCellStyle
                              }
                            >
                              {row.insurance ||
                                ""}
                            </td>

                            <td
                              style={
                                numberCellStyle
                              }
                            >
                              {row.care ||
                                ""}
                            </td>

                            <td
                              style={{
                                ...numberCellStyle,
                                fontWeight:
                                  "700",
                              }}
                            >
                              {total.toLocaleString()}
                            </td>

                          </tr>
                        );
                      }
                    )}

                  </tbody>

                </table>

              </div>

              <details
                style={{
                  marginTop: "24px",
                }}
              >

                <summary
                  style={{
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  OCR生データを確認
                </summary>

                <div
                  style={{
                    marginTop: "16px",
                  }}
                >

                  {result.rows.map(
                    (row) => (

                      <div
                        key={row.day}
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

                        <div>
                          患者：
                          {row.patients ||
                            "（空）"}
                          {" / "}

                          保険：
                          {row.insurance ||
                            "（空）"}
                          {" / "}

                          介護：
                          {row.care ||
                            "（空）"}
                        </div>

                      </div>

                    )
                  )}

                </div>

              </details>

            </section>

          )
        )}

        <footer>
          OCR位置確認版
        </footer>

      </section>
    </main>
  );
}

const cellStyle = {
  border: "1px solid #cbd5e1",
  padding: "10px",
  whiteSpace: "nowrap",
};

const numberCellStyle = {
  ...cellStyle,
  textAlign: "right",
};