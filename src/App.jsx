import { useRef, useState } from "react";

export default function App() {
  const [file, setFile] = useState(null);
  const [image, setImage] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * ==========================================
   * 大宮画像で合わせた基準
   * ==========================================
   */

  const ROW_1_CENTER = 0.0545;
  const ROW_31_CENTER = 0.8380;

  const INSURANCE = {
    x: 0.520,
    w: 0.090,
  };

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(
          new Error("画像を読み込めませんでした")
        );
      };

      img.src = url;
    });
  }

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

  /*
   * ==========================================
   * 日付ごとの中心
   * ==========================================
   */

  function getRowCenter(day) {
    const t =
      (day - 1) / 30;

    return (
      ROW_1_CENTER +
      (
        ROW_31_CENTER -
        ROW_1_CENTER
      ) *
        t
    );
  }

  /*
   * ==========================================
   * 保険診療分セルを切り抜く
   * ==========================================
   */

  function makeCell(image, day) {
    const rowStep =
      (
        ROW_31_CENTER -
        ROW_1_CENTER
      ) / 30;

    const centerY =
      image.height *
      getRowCenter(day);

    const sourceHeight =
      image.height *
      rowStep *
      0.72;

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

    canvas.width =
      Math.max(
        100,
        Math.round(
          sourceWidth
        )
      );

    canvas.height =
      Math.max(
        30,
        Math.round(
          sourceHeight
        )
      );

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

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

    return canvas;
  }

  /*
   * ==========================================
   * グレースケール
   * ==========================================
   */

  function getGrayData(canvas) {
    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const gray =
      new Uint8Array(
        canvas.width *
        canvas.height
      );

    const data =
      imageData.data;

    let p = 0;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      gray[p++] =
        Math.round(
          data[i] * 0.299 +
          data[i + 1] * 0.587 +
          data[i + 2] * 0.114
        );
    }

    return gray;
  }

  /*
   * ==========================================
   * 診療日スコア
   *
   * ポイント：
   *
   * ・右側25%は縦罫線＋0があるので
   *   判定から大きく除外
   *
   * ・左側に黒い文字が広がっているほど
   *   診療日らしい
   *
   * ・モアレ対策として
   *   1画素単位ではなく列単位で見る
   * ==========================================
   */

  function getTreatmentScore(canvas) {
    const w = canvas.width;
    const h = canvas.height;

    const gray =
      getGrayData(canvas);

    /*
     * 上下の罫線・ノイズを除外
     */
    const yStart =
      Math.floor(h * 0.18);

    const yEnd =
      Math.ceil(h * 0.82);

    /*
     * 右側は
     * 0と縦罫線があるので除外
     *
     * 左～65%だけを見る
     */
    const xStart =
      Math.floor(w * 0.05);

    const xEnd =
      Math.floor(w * 0.66);

    const columnScores = [];

    for (
      let x = xStart;
      x < xEnd;
      x++
    ) {
      let dark = 0;
      let count = 0;

      for (
        let y = yStart;
        y < yEnd;
        y++
      ) {
        const value =
          gray[
            y * w + x
          ];

        count++;

        /*
         * モアレより濃い部分だけ
         */
        if (value < 95) {
          dark++;
        }
      }

      columnScores.push(
        count
          ? dark / count
          : 0
      );
    }

    /*
     * 1本の列だけ黒いものは
     * モアレの可能性が高いので、
     * 隣接列も含めて判定
     */
    const active =
      columnScores.map(
        (score, index) => {
          const left =
            columnScores[
              index - 1
            ] || 0;

          const right =
            columnScores[
              index + 1
            ] || 0;

          const average =
            (
              left +
              score +
              right
            ) / 3;

          return (
            average >
            0.12
          );
        }
      );

    /*
     * 活性列の総数
     */
    const activeCount =
      active.filter(Boolean)
        .length;

    /*
     * 活性列がどこまで広がっているか
     */
    let first = -1;
    let last = -1;

    for (
      let i = 0;
      i < active.length;
      i++
    ) {
      if (active[i]) {
        if (first < 0) {
          first = i;
        }

        last = i;
      }
    }

    const span =
      first >= 0
        ? (
            last -
            first +
            1
          ) /
          active.length
        : 0;

    const density =
      active.length
        ? activeCount /
          active.length
        : 0;

    /*
     * 横幅を重視
     */
    const score =
      span * 0.70 +
      density * 0.30;

    return {
      score,
      span,
      density,
    };
  }

  /*
   * ==========================================
   * プレビュー
   * ==========================================
   */

  function makePreview(canvas) {
    const preview =
      document.createElement(
        "canvas"
      );

    preview.width = 420;
    preview.height = 90;

    const ctx =
      preview.getContext(
        "2d"
      );

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      preview.width,
      preview.height
    );

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      "high";

    ctx.drawImage(
      canvas,
      0,
      0,
      preview.width,
      preview.height
    );

    return preview.toDataURL(
      "image/jpeg",
      0.92
    );
  }

  /*
   * ==========================================
   * 31日分を解析
   * ==========================================
   */

  function detectDays() {
    if (!image) return;

    const output = [];

    for (
      let day = 1;
      day <= 31;
      day++
    ) {
      const cell =
        makeCell(
          image,
          day
        );

      const detection =
        getTreatmentScore(
          cell
        );

      output.push({
        day,
        score:
          detection.score,

        span:
          detection.span,

        density:
          detection.density,

        preview:
          makePreview(cell),
      });
    }

    /*
     * ========================================
     * 自動しきい値
     *
     * 非診療日が多数ある前提で
     * 下位側の中央値を基準にする
     * ========================================
     */

    const sorted =
      output
        .map(
          (row) =>
            row.score
        )
        .sort(
          (a, b) =>
            a - b
        );

    const median =
      sorted[
        Math.floor(
          sorted.length / 2
        )
      ];

    /*
     * まずは診断目的で少し厳しめ
     */
    const threshold =
      Math.max(
        median + 0.10,
        0.22
      );

    const finalRows =
      output.map(
        (row) => ({
          ...row,

          selected:
            row.score >
            threshold,
        })
      );

    setRows(finalRows);
  }

  function toggleDay(day) {
    setRows(
      (current) =>
        current.map(
          (row) =>
            row.day === day
              ? {
                  ...row,
                  selected:
                    !row.selected,
                }
              : row
        )
    );
  }

  const selectedDays =
    rows
      .filter(
        (row) =>
          row.selected
      )
      .map(
        (row) =>
          row.day
      );

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
              診療日検出テスト
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
              診療日を検出
            </h2>

            <p className="description">
              保険診療分の数字が
              左方向へどれだけ広がっているかを使って
              診療日を判定します。
            </p>

            <button
              className="select-button"
              onClick={
                detectDays
              }
            >
              診療日を検出
            </button>

          </section>
        )}

        {rows.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              判定結果
            </h2>

            <div
              style={{
                padding:
                  "12px",

                marginBottom:
                  "18px",

                borderRadius:
                  "10px",

                background:
                  "#eef6ff",

                fontWeight:
                  700,
              }}
            >
              診療日候補：
              {selectedDays.length}
              日
              <br />

              {selectedDays.join(
                "・"
              )}
            </div>

            {rows.map(
              (row) => (
                <div
                  key={row.day}
                  onClick={() =>
                    toggleDay(
                      row.day
                    )
                  }
                  style={{
                    display:
                      "flex",

                    alignItems:
                      "center",

                    gap:
                      "10px",

                    padding:
                      "7px",

                    marginBottom:
                      "7px",

                    border:
                      row.selected
                        ? "2px solid #2563eb"
                        : "1px solid #e2e8f0",

                    background:
                      row.selected
                        ? "#dbeafe"
                        : "#fff",

                    borderRadius:
                      "9px",

                    cursor:
                      "pointer",
                  }}
                >

                  <div
                    style={{
                      width:
                        "42px",

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

                        fontSize:
                          "18px",
                      }}
                    >
                      {row.day}
                    </div>

                    <div
                      style={{
                        fontSize:
                          "9px",

                        color:
                          "#64748b",
                      }}
                    >
                      {row.score.toFixed(
                        3
                      )}
                    </div>
                  </div>

                  <img
                    src={
                      row.preview
                    }
                    alt=""
                    style={{
                      width:
                        "calc(100% - 52px)",

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
          診療日検出テスト
        </footer>

      </section>
    </main>
  );
}