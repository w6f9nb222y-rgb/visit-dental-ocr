import { useRef, useState } from "react";

export default function App() {
  const [file, setFile] = useState(null);
  const [image, setImage] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * ==========================================
   * 大宮画像で確定した位置
   * ==========================================
   */

  const ROW_1_CENTER = 0.0545;
  const ROW_31_CENTER = 0.8380;

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
        const img = new Image();

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
   * セル切り抜き
   *
   * 前回より上下を狭くして
   * 横罫線の影響を減らす
   * ==========================================
   */

  function makeCell(
    image,
    day
  ) {
    const rowStep =
      (
        ROW_31_CENTER -
        ROW_1_CENTER
      ) / 30;

    const centerY =
      image.height *
      getRowCenter(day);

    /*
     * 31日は下罫線が近いので
     * 少しだけさらに狭くする
     */
    const heightRatio =
      day === 31
        ? 0.42
        : 0.56;

    const sourceHeight =
      image.height *
      rowStep *
      heightRatio;

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
        120,
        Math.round(
          sourceWidth
        )
      );

    canvas.height =
      Math.max(
        28,
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
   * 強いモアレ平均化
   *
   * 一度かなり小さくして
   * 液晶の細かい格子を平均化
   * ==========================================
   */

  function makeSmoothed(
    source
  ) {
    const small =
      document.createElement(
        "canvas"
      );

    /*
     * 元の縦横比を保ちつつ
     * かなり縮小
     */
    small.width = 150;
    small.height = 34;

    const ctx =
      small.getContext(
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
      small.width,
      small.height
    );

    ctx.imageSmoothingEnabled =
      true;

    ctx.imageSmoothingQuality =
      "high";

    /*
     * 軽いぼかしをかけながら縮小
     */
    ctx.filter = "blur(1.6px)";

    ctx.drawImage(
      source,
      0,
      0,
      small.width,
      small.height
    );

    ctx.filter = "none";

    return small;
  }

  /*
   * ==========================================
   * グレースケールデータ
   * ==========================================
   */

  function getGray(
    canvas
  ) {
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

    const src =
      imageData.data;

    const gray =
      new Float32Array(
        canvas.width *
        canvas.height
      );

    let p = 0;

    for (
      let i = 0;
      i < src.length;
      i += 4
    ) {
      gray[p++] =
        src[i] * 0.299 +
        src[i + 1] * 0.587 +
        src[i + 2] * 0.114;
    }

    return gray;
  }

  /*
   * ==========================================
   * 文字らしさを判定
   *
   * ポイント：
   *
   * ・右端の「0」は見ない
   * ・左側に存在する太い低周波成分だけ見る
   * ・細かいモアレは縮小＋ぼかしで消す
   * ==========================================
   */

  function getTextScore(
    source
  ) {
    const smoothed =
      makeSmoothed(source);

    const w =
      smoothed.width;

    const h =
      smoothed.height;

    const gray =
      getGray(smoothed);

    /*
     * 数字が広がる左側のみを見る
     *
     * 右側約30%は
     * 「0」と縦罫線があるので除外
     */
    const xStart =
      Math.floor(w * 0.08);

    const xEnd =
      Math.floor(w * 0.68);

    const yStart =
      Math.floor(h * 0.15);

    const yEnd =
      Math.floor(h * 0.85);

    /*
     * まず領域全体の平均輝度
     */
    let sum = 0;
    let count = 0;

    for (
      let y = yStart;
      y < yEnd;
      y++
    ) {
      for (
        let x = xStart;
        x < xEnd;
        x++
      ) {
        sum +=
          gray[
            y * w + x
          ];

        count++;
      }
    }

    const mean =
      count
        ? sum / count
        : 255;

    /*
     * 平均より一定以上暗い部分を
     * 「文字候補」とする
     */
    const darkThreshold =
      mean - 16;

    const columnInk =
      [];

    for (
      let x = xStart;
      x < xEnd;
      x++
    ) {
      let dark = 0;

      for (
        let y = yStart;
        y < yEnd;
        y++
      ) {
        if (
          gray[
            y * w + x
          ] <
          darkThreshold
        ) {
          dark++;
        }
      }

      columnInk.push(
        dark /
        Math.max(
          1,
          yEnd - yStart
        )
      );
    }

    /*
     * 文字は複数列にまたがるので
     * 横方向に再度平均化
     */
    const averaged =
      columnInk.map(
        (_, index) => {
          let total = 0;
          let n = 0;

          for (
            let dx = -2;
            dx <= 2;
            dx++
          ) {
            const value =
              columnInk[
                index + dx
              ];

            if (
              value !==
              undefined
            ) {
              total += value;
              n++;
            }
          }

          return n
            ? total / n
            : 0;
        }
      );

    /*
     * 十分に太い領域だけ
     */
    const active =
      averaged.map(
        (value) =>
          value > 0.18
      );

    /*
     * 連続した活性領域を抽出
     */
    const runs = [];

    let start = null;

    for (
      let i = 0;
      i <= active.length;
      i++
    ) {
      const on =
        i < active.length
          ? active[i]
          : false;

      if (
        on &&
        start === null
      ) {
        start = i;
      }

      if (
        !on &&
        start !== null
      ) {
        runs.push({
          start,
          end: i - 1,
          width:
            i - start,
        });

        start = null;
      }
    }

    /*
     * かなり細いものは
     * モアレとして除外
     */
    const strongRuns =
      runs.filter(
        (run) =>
          run.width >= 3
      );

    const strongWidth =
      strongRuns.reduce(
        (sum, run) =>
          sum +
          run.width,
        0
      );

    /*
     * 一番左に数字がどこまであるか
     */
    const firstRun =
      strongRuns[0];

    const lastRun =
      strongRuns[
        strongRuns.length -
          1
      ];

    const span =
      firstRun &&
      lastRun
        ? (
            lastRun.end -
            firstRun.start +
            1
          ) /
          active.length
        : 0;

    const widthRatio =
      strongWidth /
      Math.max(
        1,
        active.length
      );

    /*
     * 数字の塊が複数あるほど
     * 診療日らしい
     */
    const componentScore =
      Math.min(
        strongRuns.length /
          4,
        1
      );

    const score =
      span * 0.45 +
      widthRatio * 0.35 +
      componentScore * 0.20;

    return {
      score,
      span,
      widthRatio,
      components:
        strongRuns.length,
      smoothed,
    };
  }

  /*
   * ==========================================
   * 確認用プレビュー
   * ==========================================
   */

  function makePreview(
    source
  ) {
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
      source,
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

  /*
   * ==========================================
   * 31日解析
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
      const raw =
        makeCell(
          image,
          day
        );

      const result =
        getTextScore(raw);

      output.push({
        day,

        score:
          result.score,

        span:
          result.span,

        widthRatio:
          result.widthRatio,

        components:
          result.components,

        preview:
          makePreview(raw),

        smoothedPreview:
          makePreview(
            result.smoothed
          ),
      });
    }

    /*
     * ======================================
     * 非診療日多数を前提に
     * スコア分布から自動しきい値
     * ======================================
     */

    const scores =
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
      scores[
        Math.floor(
          scores.length /
            2
        )
      ];

    const deviations =
      scores
        .map(
          (value) =>
            Math.abs(
              value -
              median
            )
        )
        .sort(
          (a, b) =>
            a - b
        );

    const mad =
      deviations[
        Math.floor(
          deviations.length /
            2
        )
      ];

    /*
     * 今回は少し緩め
     *
     * 見逃すより、
     * 余計な日を少し選ぶ方を優先
     */
    const threshold =
      median +
      Math.max(
        mad * 1.8,
        0.035
      );

    const finalRows =
      output.map(
        (row) => ({
          ...row,

          selected:
            row.score >
              threshold &&
            row.day !== 31
              ? true
              : row.day === 31 &&
                row.score >
                  threshold +
                    0.08,
        })
      );

    setRows(finalRows);
  }

  /*
   * ==========================================
   * 手動ON/OFF
   * ==========================================
   */

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
              液晶モアレを強く平均化してから、
              数字の太い形だけを探します。
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

                background:
                  "#eef6ff",

                borderRadius:
                  "10px",

                marginBottom:
                  "18px",

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
                  key={
                    row.day
                  }
                  onClick={() =>
                    toggleDay(
                      row.day
                    )
                  }
                  style={{
                    marginBottom:
                      "10px",

                    padding:
                      "8px",

                    border:
                      row.selected
                        ? "2px solid #2563eb"
                        : "1px solid #e2e8f0",

                    background:
                      row.selected
                        ? "#dbeafe"
                        : "#fff",

                    borderRadius:
                      "10px",
                  }}
                >

                  <div
                    style={{
                      display:
                        "flex",

                      alignItems:
                        "center",

                      gap:
                        "10px",
                    }}
                  >
                    <div
                      style={{
                        width:
                          "46px",

                        flexShrink:
                          0,

                        textAlign:
                          "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize:
                            "19px",

                          fontWeight:
                            700,
                        }}
                      >
                        {
                          row.day
                        }
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
                          "calc(100% - 56px)",

                        height:
                          "52px",

                        objectFit:
                          "contain",

                        background:
                          "#fff",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      marginTop:
                        "6px",

                      paddingTop:
                        "6px",

                      borderTop:
                        "1px dashed #cbd5e1",

                      display:
                        "flex",

                      alignItems:
                        "center",

                      gap:
                        "8px",
                    }}
                  >
                    <div
                      style={{
                        width:
                          "46px",

                        fontSize:
                          "9px",

                        color:
                          "#64748b",
                      }}
                    >
                      平均化
                    </div>

                    <img
                      src={
                        row.smoothedPreview
                      }
                      alt=""
                      style={{
                        width:
                          "calc(100% - 56px)",

                        height:
                          "38px",

                        objectFit:
                          "contain",

                        background:
                          "#fff",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      fontSize:
                        "9px",

                      color:
                        "#64748b",

                      marginTop:
                        "5px",

                      textAlign:
                        "right",
                    }}
                  >
                    span{" "}
                    {row.span.toFixed(
                      2
                    )}
                    {" / "}
                    width{" "}
                    {row.widthRatio.toFixed(
                      2
                    )}
                    {" / "}
                    blocks{" "}
                    {
                      row.components
                    }
                  </div>

                </div>
              )
            )}

          </section>
        )}

        <footer>
          モアレ平均化・診療日検出
        </footer>

      </section>
    </main>
  );
}