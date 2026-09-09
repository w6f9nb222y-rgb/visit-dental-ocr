import { useRef, useState } from "react";
import { createWorker } from "tesseract.js";

export default function App() {
  const [file, setFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [elapsed, setElapsed] = useState(null);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * ここまでに合わせた座標は固定
   */
  const ROW_1_CENTER = 0.0550;
  const ROW_STEP = 0.0267;

  const COLUMNS = {
    patients: {
      label: "実患者",
      x: 0.4820,
      w: 0.0300,
      maxDigits: 2,
    },

    insurance: {
      label: "保険診療分",
      x: 0.5280,
      w: 0.0700,
      maxDigits: 5,
    },

    care: {
      label: "介護保険",
      x: 0.7970,
      w: 0.0600,
      maxDigits: 5,
    },
  };

  const TEST_DAYS = [7, 14, 21, 28];

  function handleFile(event) {
    const selected = event.target.files?.[0];

    if (!selected) return;

    setFile(selected);
    setResults([]);
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

  /*
   * ==================================================
   * セル切り抜き
   * ==================================================
   */

  function makeRawCell(image, day, columnKey) {
    const column = COLUMNS[columnKey];

    const centerY =
      image.height *
      (ROW_1_CENTER + (day - 1) * ROW_STEP);

    const sourceHeight =
      image.height *
      ROW_STEP *
      0.60;

    const sourceY =
      centerY - sourceHeight / 2;

    const sourceX =
      image.width * column.x;

    const sourceWidth =
      image.width * column.w;

    const canvas =
      document.createElement("canvas");

    canvas.width =
      Math.max(40, Math.round(sourceWidth));

    canvas.height =
      Math.max(20, Math.round(sourceHeight));

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.fillStyle = "#fff";
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
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  }

  /*
   * ==================================================
   * 軽いモアレ低減
   * ==================================================
   */

  function reduceMoire(source) {
    const small =
      document.createElement("canvas");

    /*
     * 今回は強く縮小しない
     */
    const factor = 0.68;

    small.width =
      Math.max(
        25,
        Math.round(source.width * factor)
      );

    small.height =
      Math.max(
        14,
        Math.round(source.height * factor)
      );

    const sctx =
      small.getContext("2d", {
        willReadFrequently: true,
      });

    sctx.fillStyle = "#fff";
    sctx.fillRect(
      0,
      0,
      small.width,
      small.height
    );

    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";

    sctx.drawImage(
      source,
      0,
      0,
      small.width,
      small.height
    );

    return small;
  }

  /*
   * ==================================================
   * グレースケール
   * ==================================================
   */

  function grayscale(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray =
        data[i] * 0.299 +
        data[i + 1] * 0.587 +
        data[i + 2] * 0.114;

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas;
  }

  /*
   * ==================================================
   * Otsu自動閾値
   * ==================================================
   */

  function getOtsuThreshold(source) {
    const ctx =
      source.getContext("2d", {
        willReadFrequently: true,
      });

    const imageData =
      ctx.getImageData(
        0,
        0,
        source.width,
        source.height
      );

    const histogram =
      new Array(256).fill(0);

    for (
      let i = 0;
      i < imageData.data.length;
      i += 4
    ) {
      histogram[
        Math.round(imageData.data[i])
      ]++;
    }

    const total =
      source.width * source.height;

    let sum = 0;

    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }

    let sumB = 0;
    let weightB = 0;
    let maxVariance = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      weightB += histogram[t];

      if (weightB === 0) continue;

      const weightF =
        total - weightB;

      if (weightF === 0) break;

      sumB +=
        t * histogram[t];

      const meanB =
        sumB / weightB;

      const meanF =
        (sum - sumB) / weightF;

      const variance =
        weightB *
        weightF *
        Math.pow(meanB - meanF, 2);

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }

    return threshold;
  }

  /*
   * ==================================================
   * 2値化
   * ==================================================
   */

  function makeBinary(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const threshold =
      getOtsuThreshold(canvas);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data = imageData.data;

    /*
     * 少し厳しめにしてモアレを落とす
     */
    const adjusted =
      threshold - 12;

    for (let i = 0; i < data.length; i += 4) {
      const value =
        data[i] < adjusted
          ? 0
          : 255;

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

    return canvas;
  }

  /*
   * ==================================================
   * 明らかな縦罫線を消す
   * ==================================================
   */

  function removeVerticalRules(source) {
    const canvas =
      document.createElement("canvas");

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data = imageData.data;

    for (let x = 0; x < canvas.width; x++) {
      let darkCount = 0;

      for (
        let y = 0;
        y < canvas.height;
        y++
      ) {
        const index =
          (y * canvas.width + x) * 4;

        if (data[index] < 50) {
          darkCount++;
        }
      }

      /*
       * 高さの70%以上黒なら
       * 罫線とみなす
       */
      if (
        darkCount / canvas.height >
        0.70
      ) {
        for (
          let dx = -1;
          dx <= 1;
          dx++
        ) {
          const px = x + dx;

          if (
            px < 0 ||
            px >= canvas.width
          ) {
            continue;
          }

          for (
            let y = 0;
            y < canvas.height;
            y++
          ) {
            const index =
              (y * canvas.width + px) * 4;

            data[index] = 255;
            data[index + 1] = 255;
            data[index + 2] = 255;
            data[index + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(
      imageData,
      0,
      0
    );

    return canvas;
  }

  /*
   * ==================================================
   * 上下のノイズを減らす
   *
   * 数字はセル中央付近にあるので
   * 上下端を少し捨てる
   * ==================================================
   */

  function cropVerticalCenter(source) {
    const top =
      Math.floor(source.height * 0.12);

    const bottom =
      Math.floor(source.height * 0.88);

    const height =
      bottom - top;

    const canvas =
      document.createElement("canvas");

    canvas.width =
      source.width;

    canvas.height =
      height;

    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      source,
      0,
      top,
      source.width,
      height,
      0,
      0,
      source.width,
      height
    );

    return canvas;
  }

  /*
   * ==================================================
   * 横方向の黒画素量から
   * 1文字ずつ切り分ける
   * ==================================================
   */

  function segmentCharacters(
    binaryCanvas,
    maxDigits
  ) {
    const ctx =
      binaryCanvas.getContext("2d", {
        willReadFrequently: true,
      });

    const w =
      binaryCanvas.width;

    const h =
      binaryCanvas.height;

    const imageData =
      ctx.getImageData(
        0,
        0,
        w,
        h
      );

    const data =
      imageData.data;

    const columnInk =
      new Array(w).fill(0);

    /*
     * 各X列に何個黒画素があるか
     */
    for (let x = 0; x < w; x++) {
      let count = 0;

      for (let y = 0; y < h; y++) {
        const index =
          (y * w + x) * 4;

        if (data[index] < 80) {
          count++;
        }
      }

      columnInk[x] = count;
    }

    /*
     * 少量のモアレは無視
     */
    const minimumInk =
      Math.max(
        1,
        Math.floor(h * 0.08)
      );

    const active =
      columnInk.map(
        (count) =>
          count >= minimumInk
      );

    /*
     * 文字内の1～2px程度の隙間は
     * 同一文字とみなす
     */
    const maxGap =
      Math.max(
        1,
        Math.round(w * 0.012)
      );

    let previousActive = -999;

    for (let x = 0; x < w; x++) {
      if (!active[x]) continue;

      if (
        x - previousActive <=
        maxGap + 1
      ) {
        for (
          let xx = previousActive + 1;
          xx < x;
          xx++
        ) {
          if (xx >= 0) {
            active[xx] = true;
          }
        }
      }

      previousActive = x;
    }

    /*
     * 連続領域を抽出
     */
    const runs = [];

    let start = null;

    for (let x = 0; x <= w; x++) {
      const on =
        x < w
          ? active[x]
          : false;

      if (on && start === null) {
        start = x;
      }

      if (!on && start !== null) {
        runs.push({
          start,
          end: x - 1,
        });

        start = null;
      }
    }

    /*
     * 極端に細いゴミを捨てる
     */
    let filtered =
      runs.filter((run) => {
        const width =
          run.end -
          run.start +
          1;

        return (
          width >=
          Math.max(
            2,
            Math.round(w * 0.012)
          )
        );
      });

    /*
     * 候補が多過ぎたら
     * 幅の大きいものを優先
     */
    if (
      filtered.length >
      maxDigits + 2
    ) {
      filtered =
        filtered
          .map((run, index) => ({
            ...run,
            index,
            width:
              run.end -
              run.start +
              1,
          }))
          .sort(
            (a, b) =>
              b.width - a.width
          )
          .slice(
            0,
            maxDigits + 2
          )
          .sort(
            (a, b) =>
              a.start - b.start
          );
    }

    /*
     * カンマらしい小さい領域を除外
     */
    if (
      filtered.length >
      maxDigits
    ) {
      const heights =
        filtered.map((run) =>
          getRunInkHeight(
            binaryCanvas,
            run.start,
            run.end
          )
        );

      const maxHeight =
        Math.max(...heights);

      filtered =
        filtered.filter(
          (run, index) =>
            heights[index] >
            maxHeight * 0.45
        );
    }

    /*
     * まだ多ければ上限まで
     */
    if (
      filtered.length >
      maxDigits
    ) {
      filtered =
        filtered
          .map((run) => ({
            ...run,
            ink:
              getRunInkCount(
                binaryCanvas,
                run.start,
                run.end
              ),
          }))
          .sort(
            (a, b) =>
              b.ink - a.ink
          )
          .slice(0, maxDigits)
          .sort(
            (a, b) =>
              a.start - b.start
          );
    }

    const characterCanvases =
      filtered.map((run) =>
        makeCharacterCanvas(
          binaryCanvas,
          run.start,
          run.end
        )
      );

    return {
      runs: filtered,
      characters:
        characterCanvases,
    };
  }

  function getRunInkHeight(
    canvas,
    startX,
    endX
  ) {
    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    const w = canvas.width;
    const h = canvas.height;

    const data =
      ctx.getImageData(
        0,
        0,
        w,
        h
      ).data;

    let minY = h;
    let maxY = -1;

    for (
      let x = startX;
      x <= endX;
      x++
    ) {
      for (let y = 0; y < h; y++) {
        const index =
          (y * w + x) * 4;

        if (data[index] < 80) {
          minY =
            Math.min(minY, y);

          maxY =
            Math.max(maxY, y);
        }
      }
    }

    if (maxY < minY) {
      return 0;
    }

    return (
      maxY - minY + 1
    );
  }

  function getRunInkCount(
    canvas,
    startX,
    endX
  ) {
    const ctx =
      canvas.getContext("2d", {
        willReadFrequently: true,
      });

    const w =
      canvas.width;

    const h =
      canvas.height;

    const data =
      ctx.getImageData(
        0,
        0,
        w,
        h
      ).data;

    let count = 0;

    for (
      let x = startX;
      x <= endX;
      x++
    ) {
      for (
        let y = 0;
        y < h;
        y++
      ) {
        const index =
          (y * w + x) * 4;

        if (data[index] < 80) {
          count++;
        }
      }
    }

    return count;
  }

  /*
   * ==================================================
   * 1文字を正方形に近い画像へ
   * ==================================================
   */

  function makeCharacterCanvas(
    source,
    startX,
    endX
  ) {
    const ctx =
      source.getContext("2d", {
        willReadFrequently: true,
      });

    const w =
      source.width;

    const h =
      source.height;

    const data =
      ctx.getImageData(
        0,
        0,
        w,
        h
      ).data;

    let minY = h;
    let maxY = -1;

    for (
      let x = startX;
      x <= endX;
      x++
    ) {
      for (
        let y = 0;
        y < h;
        y++
      ) {
        const index =
          (y * w + x) * 4;

        if (data[index] < 80) {
          minY =
            Math.min(minY, y);

          maxY =
            Math.max(maxY, y);
        }
      }
    }

    if (maxY < minY) {
      minY = 0;
      maxY = h - 1;
    }

    const sourceWidth =
      endX - startX + 1;

    const sourceHeight =
      maxY - minY + 1;

    const targetSize = 140;

    const canvas =
      document.createElement("canvas");

    canvas.width = targetSize;
    canvas.height = targetSize;

    const tctx =
      canvas.getContext("2d");

    tctx.fillStyle = "#fff";

    tctx.fillRect(
      0,
      0,
      targetSize,
      targetSize
    );

    const usable = 90;

    const scale =
      Math.min(
        usable / sourceWidth,
        usable / sourceHeight
      );

    const dw =
      sourceWidth * scale;

    const dh =
      sourceHeight * scale;

    const dx =
      (targetSize - dw) / 2;

    const dy =
      (targetSize - dh) / 2;

    tctx.imageSmoothingEnabled = false;

    tctx.drawImage(
      source,
      startX,
      minY,
      sourceWidth,
      sourceHeight,
      dx,
      dy,
      dw,
      dh
    );

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise(
      (resolve, reject) => {
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
      }
    );
  }

  /*
   * ==================================================
   * 1文字OCR
   * ==================================================
   */

  async function recognizeSingleDigit(
    worker,
    canvas
  ) {
    const blob =
      await canvasToBlob(canvas);

    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789",

      /*
       * 10 = single character
       */
      tessedit_pageseg_mode:
        "10",

      user_defined_dpi:
        "300",
    });

    const result =
      await worker.recognize(blob);

    const text =
      String(
        result.data.text || ""
      )
        .replace(/\D/g, "");

    /*
     * 1文字だけ採用
     */
    return text
      ? text[0]
      : "";
  }

  /*
   * ==================================================
   * セル全体処理
   * ==================================================
   */

  async function recognizeCell(
    worker,
    image,
    day,
    columnKey
  ) {
    const raw =
      makeRawCell(
        image,
        day,
        columnKey
      );

    const reduced =
      reduceMoire(raw);

    const gray =
      grayscale(reduced);

    const binary =
      makeBinary(gray);

    const noLines =
      removeVerticalRules(binary);

    const centered =
      cropVerticalCenter(noLines);

    const segmented =
      segmentCharacters(
        centered,
        COLUMNS[columnKey]
          .maxDigits
      );

    const digits = [];

    for (
      const charCanvas of
      segmented.characters
    ) {
      const digit =
        await recognizeSingleDigit(
          worker,
          charCanvas
        );

      if (digit) {
        digits.push(digit);
      }
    }

    let value =
      digits.join("");

    /*
     * 最終的な桁数制限
     */
    if (
      columnKey === "patients" &&
      value.length > 2
    ) {
      value =
        value.slice(-2);
    }

    if (
      columnKey !== "patients" &&
      value.length > 5
    ) {
      value =
        value.slice(-5);
    }

    return {
      value,

      preview:
        centered.toDataURL(
          "image/png"
        ),

      chars:
        segmented.characters.map(
          (canvas) =>
            canvas.toDataURL(
              "image/png"
            )
        ),

      recognizedChars:
        digits,
    };
  }

  /*
   * ==================================================
   * 全体解析
   * ==================================================
   */

  async function analyzeImage() {
    if (!file || isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    setResults([]);
    setElapsed(null);
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

      setStatusText(
        "1文字OCRを準備しています…"
      );

      worker =
        await createWorker(
          "eng",
          1
        );

      const output = [];

      const total =
        TEST_DAYS.length * 3;

      let completed = 0;

      for (
        const day of TEST_DAYS
      ) {
        const row = {
          day,
          cells: [],
        };

        for (
          const columnKey of [
            "patients",
            "insurance",
            "care",
          ]
        ) {
          setStatusText(
            `${day}日：${COLUMNS[columnKey].label}を1文字ずつ解析中…`
          );

          const result =
            await recognizeCell(
              worker,
              image,
              day,
              columnKey
            );

          row.cells.push({
            key: columnKey,

            label:
              COLUMNS[columnKey]
                .label,

            value:
              result.value,

            preview:
              result.preview,

            chars:
              result.chars,

            recognizedChars:
              result.recognizedChars,
          });

          completed++;

          setProgress(
            Math.round(
              (completed / total) *
                100
            )
          );
        }

        output.push(row);
      }

      const finished =
        performance.now();

      setResults(output);

      setElapsed(
        (
          (finished - started) /
          1000
        ).toFixed(1)
      );

      setStatusText(
        "解析が完了しました"
      );

      setProgress(100);
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

  function formatValue(
    value,
    key
  ) {
    if (!value) {
      return "（空）";
    }

    if (key === "patients") {
      return value;
    }

    const n = Number(value);

    return Number.isFinite(n)
      ? n.toLocaleString("ja-JP")
      : value;
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

          <p className="description">
            今回は数字を1文字ずつ分離して認識します。
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
            1文字分離OCR
          </h2>

          <p className="description">
            カンマや罫線を除外し、
            数字を1文字ずつ認識して結合します。
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
            onClick={analyzeImage}
          >
            {isAnalyzing
              ? "解析中…"
              : "4日分を解析"}
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

        {results.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              1文字OCR結果
            </h2>

            <p className="description">
              下段に、分離された文字も表示します。
            </p>

            {results.map(
              (row) => (
                <div
                  key={row.day}
                  style={{
                    marginBottom:
                      "42px",
                  }}
                >

                  <h3
                    style={{
                      fontSize:
                        "22px",
                      marginBottom:
                        "14px",
                    }}
                  >
                    {row.day}日
                  </h3>

                  <div
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        "repeat(3, minmax(0, 1fr))",

                      gap: "8px",
                    }}
                  >

                    {row.cells.map(
                      (cell) => (
                        <div
                          key={cell.key}
                          style={{
                            minWidth: 0,
                          }}
                        >

                          <div
                            style={{
                              textAlign:
                                "center",

                              fontSize:
                                "11px",

                              fontWeight:
                                700,

                              marginBottom:
                                "5px",
                            }}
                          >
                            {cell.label}
                          </div>

                          <div
                            style={{
                              height:
                                "85px",

                              border:
                                "1px solid #cbd5e1",

                              borderRadius:
                                "10px",

                              background:
                                "#fff",

                              display:
                                "flex",

                              alignItems:
                                "center",

                              justifyContent:
                                "center",

                              overflow:
                                "hidden",

                              padding:
                                "4px",
                            }}
                          >
                            <img
                              src={cell.preview}
                              alt=""
                              style={{
                                width:
                                  "100%",

                                maxHeight:
                                  "75px",

                                objectFit:
                                  "contain",
                              }}
                            />
                          </div>

                          <div
                            style={{
                              marginTop:
                                "7px",

                              padding:
                                "8px 3px",

                              textAlign:
                                "center",

                              background:
                                "#f8fafc",

                              borderRadius:
                                "8px",
                            }}
                          >
                            <strong
                              style={{
                                fontSize:
                                  "20px",
                              }}
                            >
                              {formatValue(
                                cell.value,
                                cell.key
                              )}
                            </strong>
                          </div>

                          <div
                            style={{
                              marginTop:
                                "8px",

                              display:
                                "flex",

                              gap:
                                "3px",

                              justifyContent:
                                "center",

                              flexWrap:
                                "wrap",
                            }}
                          >
                            {cell.chars.map(
                              (
                                src,
                                index
                              ) => (
                                <div
                                  key={
                                    index
                                  }
                                  style={{
                                    width:
                                      "30px",

                                    textAlign:
                                      "center",
                                  }}
                                >
                                  <img
                                    src={
                                      src
                                    }
                                    alt=""
                                    style={{
                                      width:
                                        "28px",

                                      height:
                                        "28px",

                                      objectFit:
                                        "contain",

                                      border:
                                        "1px solid #ddd",

                                      background:
                                        "#fff",
                                    }}
                                  />

                                  <div
                                    style={{
                                      fontSize:
                                        "11px",

                                      fontWeight:
                                        700,
                                    }}
                                  >
                                    {cell
                                      .recognizedChars[
                                      index
                                    ] ||
                                      "?"}
                                  </div>
                                </div>
                              )
                            )}
                          </div>

                        </div>
                      )
                    )}

                  </div>

                </div>
              )
            )}

          </section>
        )}

        <footer>
          1文字分離OCRテスト
        </footer>

      </section>
    </main>
  );
}