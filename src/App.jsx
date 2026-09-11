import { useMemo, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

export default function App() {
  const now = new Date();

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [files, setFiles] = useState([]);
  const [images, setImages] = useState([]);

  const [selectedDays, setSelectedDays] = useState({});
  const [results, setResults] = useState([]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(null);
  const [error, setError] = useState("");

  const inputRef = useRef(null);

  /*
   * ==========================================
   * 現在の帳票位置
   * 大宮画像で調整済み
   * ==========================================
   */

  const ROW_1_CENTER = 0.0545;
  const ROW_31_CENTER = 0.8380;

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

  const WEEKDAYS = [
    "日",
    "月",
    "火",
    "水",
    "木",
    "金",
    "土",
  ];

  /*
   * ==========================================
   * カレンダー
   * ==========================================
   */

  const daysInMonth = useMemo(() => {
    return new Date(year, month, 0).getDate();
  }, [year, month]);

  const firstWeekday = useMemo(() => {
    return new Date(year, month - 1, 1).getDay();
  }, [year, month]);

  function getWeekday(day) {
    return new Date(
      year,
      month - 1,
      day
    ).getDay();
  }

  function getWeekdayLabel(day) {
    return WEEKDAYS[getWeekday(day)];
  }

  /*
   * ==========================================
   * 画像選択
   * ==========================================
   */

  async function handleFiles(event) {
    const selected = Array.from(
      event.target.files || []
    );

    if (!selected.length) return;

    setFiles(selected);
    setResults([]);
    setSelectedDays({});
    setError("");
    setProgress(0);
    setElapsed(null);
    setStatusText("");

    try {
      const loaded = [];

      for (const file of selected) {
        loaded.push(
          await loadImage(file)
        );
      }

      setImages(loaded);

      const initial = {};

      selected.forEach((_, index) => {
        initial[index] = [];
      });

      setSelectedDays(initial);
    } catch (e) {
      console.error(e);

      setError(
        "画像の読み込みに失敗しました"
      );
    }
  }

  function loadImage(file) {
    return new Promise(
      (resolve, reject) => {
        const image = new Image();
        const url =
          URL.createObjectURL(file);

        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };

        image.onerror = () => {
          URL.revokeObjectURL(url);

          reject(
            new Error(
              "画像を読み込めませんでした"
            )
          );
        };

        image.src = url;
      }
    );
  }

  /*
   * ==========================================
   * 日付選択
   * ==========================================
   */

  function toggleDay(fileIndex, day) {
    setSelectedDays((current) => {
      const days =
        current[fileIndex] || [];

      const exists =
        days.includes(day);

      const nextDays =
        exists
          ? days.filter(
              (d) => d !== day
            )
          : [...days, day].sort(
              (a, b) => a - b
            );

      return {
        ...current,
        [fileIndex]: nextDays,
      };
    });
  }

  function clearDays(fileIndex) {
    setSelectedDays((current) => ({
      ...current,
      [fileIndex]: [],
    }));
  }

  function selectWeekdays(
    fileIndex,
    weekdays
  ) {
    const days = [];

    for (
      let day = 1;
      day <= daysInMonth;
      day++
    ) {
      if (
        weekdays.includes(
          getWeekday(day)
        )
      ) {
        days.push(day);
      }
    }

    setSelectedDays(
      (current) => ({
        ...current,
        [fileIndex]: days,
      })
    );
  }

  /*
   * ==========================================
   * 行中心
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
   * ==========================================
   */

  function makeRawCell(
    image,
    day,
    key
  ) {
    const column =
      COLUMNS[key];

    const rowStep =
      (
        ROW_31_CENTER -
        ROW_1_CENTER
      ) / 30;

    const centerY =
      image.height *
      getRowCenter(day);

    let heightRatio = 0.64;

    if (day === 31) {
      heightRatio = 0.48;
    }

    const sourceHeight =
      image.height *
      rowStep *
      heightRatio;

    const sourceY =
      centerY -
      sourceHeight / 2;

    const sourceX =
      image.width *
      column.x;

    const sourceWidth =
      image.width *
      column.w;

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      Math.max(
        60,
        Math.round(sourceWidth)
      );

    canvas.height =
      Math.max(
        24,
        Math.round(sourceHeight)
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

  function grayscale(source) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const gray =
        data[i] * 0.299 +
        data[i + 1] * 0.587 +
        data[i + 2] * 0.114;

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
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
   * ==========================================
   * モアレ低減
   * ==========================================
   */

  function reduceMoire(
    source,
    factor
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      Math.max(
        30,
        Math.round(
          source.width * factor
        )
      );

    canvas.height =
      Math.max(
        18,
        Math.round(
          source.height * factor
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
      source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  }

  /*
   * ==========================================
   * コントラスト
   * ==========================================
   */

  function increaseContrast(
    source,
    amount
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      let value = data[i];

      value =
        (value - 128) *
          amount +
        128;

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

    return canvas;
  }

  /*
   * ==========================================
   * 2値化
   * ==========================================
   */

  function threshold(
    source,
    value
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let i = 0;
      i < data.length;
      i += 4
    ) {
      const v =
        data[i] < value
          ? 0
          : 255;

      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
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
   * ==========================================
   * 縦罫線除去
   * ==========================================
   */

  function removeVerticalRules(
    source
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently:
            true,
        }
      );

    ctx.drawImage(source, 0, 0);

    const imageData =
      ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const data =
      imageData.data;

    for (
      let x = 0;
      x < canvas.width;
      x++
    ) {
      let dark = 0;

      for (
        let y = 0;
        y < canvas.height;
        y++
      ) {
        const index =
          (
            y *
              canvas.width +
            x
          ) * 4;

        if (
          data[index] < 80
        ) {
          dark++;
        }
      }

      /*
       * 高さの80%以上が暗い列なら
       * 縦罫線の可能性が高い
       */
      if (
        dark /
          canvas.height >
        0.80
      ) {
        for (
          let dx = -2;
          dx <= 2;
          dx++
        ) {
          const px =
            x + dx;

          if (
            px < 0 ||
            px >=
              canvas.width
          ) {
            continue;
          }

          for (
            let y = 0;
            y <
            canvas.height;
            y++
          ) {
            const index =
              (
                y *
                  canvas.width +
                px
              ) * 4;

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
   * ==========================================
   * 白余白追加
   * ==========================================
   */

  function addPadding(
    source,
    padding = 14
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      source.width +
      padding * 2;

    canvas.height =
      source.height +
      padding * 2;

    const ctx =
      canvas.getContext("2d");

    ctx.fillStyle = "#fff";

    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.drawImage(
      source,
      padding,
      padding
    );

    return canvas;
  }

  /*
   * ==========================================
   * 拡大
   * ==========================================
   */

  function upscale(
    source,
    scale = 4
  ) {
    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      source.width * scale;

    canvas.height =
      source.height * scale;

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
   * ==========================================
   * OCR文字整理
   * ==========================================
   */

  function cleanOCR(
    text,
    key
  ) {
    let value =
      String(text || "")
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/\D/g, "");

    const maxDigits =
      COLUMNS[key]
        .maxDigits;

    if (
      value.length >
      maxDigits
    ) {
      value =
        value.slice(
          -maxDigits
        );
    }

    return value;
  }

  /*
   * ==========================================
   * OCR 1回
   * ==========================================
   */

  async function recognizeVariant(
    worker,
    canvas,
    key,
    psm
  ) {
    const blob =
      await canvasToBlob(canvas);

    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789",

      tessedit_pageseg_mode:
        String(psm),

      user_defined_dpi:
        "300",

      preserve_interword_spaces:
        "0",
    });

    const result =
      await worker.recognize(
        blob
      );

    return {
      value:
        cleanOCR(
          result.data.text,
          key
        ),

      confidence:
        Number(
          result.data.confidence ||
          0
        ),

      psm,
    };
  }

  /*
   * ==========================================
   * 候補の自然さを採点
   * ==========================================
   */

  function plausibilityScore(
    value,
    key
  ) {
    if (!value) {
      return -100;
    }

    const n =
      Number(value);

    if (
      !Number.isFinite(n)
    ) {
      return -100;
    }

    let score = 0;

    if (
      key === "patients"
    ) {
      if (
        value.length === 2
      ) {
        score += 35;
      } else if (
        value.length === 1
      ) {
        score += 15;
      }

      if (
        n >= 1 &&
        n <= 40
      ) {
        score += 35;
      } else if (
        n <= 60
      ) {
        score += 10;
      } else {
        score -= 40;
      }

      return score;
    }

    /*
     * 保険・介護
     */

    if (
      value.length === 5
    ) {
      score += 45;
    } else if (
      value.length === 4
    ) {
      score += 35;
    } else if (
      value.length === 3
    ) {
      score += 5;
    } else {
      score -= 35;
    }

    if (
      n >= 1000 &&
      n <= 50000
    ) {
      score += 30;
    } else if (
      n >= 100 &&
      n < 1000
    ) {
      score += 5;
    } else {
      score -= 30;
    }

    return score;
  }

  /*
   * ==========================================
   * 最良候補を選択
   * ==========================================
   */

  function selectBestCandidate(
    attempts,
    key
  ) {
    const grouped = {};

    for (
      const attempt of attempts
    ) {
      if (!attempt.value) {
        continue;
      }

      if (
        !grouped[
          attempt.value
        ]
      ) {
        grouped[
          attempt.value
        ] = {
          value:
            attempt.value,

          count: 0,

          confidence: 0,
        };
      }

      grouped[
        attempt.value
      ].count++;

      grouped[
        attempt.value
      ].confidence +=
        attempt.confidence;
    }

    const candidates =
      Object.values(
        grouped
      );

    if (
      !candidates.length
    ) {
      return {
        value: "",
        warning: true,
        score: -100,
      };
    }

    for (
      const candidate of
      candidates
    ) {
      const avgConfidence =
        candidate.confidence /
        candidate.count;

      candidate.score =
        plausibilityScore(
          candidate.value,
          key
        ) +
        candidate.count * 25 +
        avgConfidence * 0.15;
    }

    candidates.sort(
      (a, b) =>
        b.score -
        a.score
    );

    const best =
      candidates[0];

    /*
     * 要確認判定
     */

    let warning = false;

    if (
      best.count < 2
    ) {
      warning = true;
    }

    if (
      plausibilityScore(
        best.value,
        key
      ) < 30
    ) {
      warning = true;
    }

    /*
     * 2位との差が小さい場合も怪しい
     */

    if (
      candidates.length > 1
    ) {
      const gap =
        best.score -
        candidates[1].score;

      if (gap < 15) {
        warning = true;
      }
    }

    return {
      value:
        best.value,

      warning,

      score:
        best.score,
    };
  }

  /*
   * ==========================================
   * セルOCR
   * ==========================================
   */

  async function recognizeCell(
    worker,
    image,
    day,
    key
  ) {
    const raw =
      makeRawCell(
        image,
        day,
        key
      );

    const gray =
      grayscale(raw);

    /*
     * 罫線を先に除去
     */

    const cleanGray =
      removeVerticalRules(
        gray
      );

    /*
     * 4種類の画像
     */

    const originalVariant =
      upscale(
        addPadding(
          increaseContrast(
            cleanGray,
            1.35
          ),
          10
        ),
        3
      );

    const reduced =
      reduceMoire(
        cleanGray,
        0.72
      );

    const contrastVariant =
      upscale(
        addPadding(
          increaseContrast(
            reduced,
            1.55
          ),
          10
        ),
        4
      );

    const binary160 =
      upscale(
        addPadding(
          threshold(
            reduced,
            160
          ),
          10
        ),
        4
      );

    const binary180 =
      upscale(
        addPadding(
          threshold(
            reduced,
            180
          ),
          10
        ),
        4
      );

    /*
     * PSMも変える
     */

    const configs = [
      {
        canvas:
          originalVariant,
        psm: 7,
      },

      {
        canvas:
          originalVariant,
        psm: 8,
      },

      {
        canvas:
          contrastVariant,
        psm: 7,
      },

      {
        canvas:
          contrastVariant,
        psm: 13,
      },

      {
        canvas:
          binary160,
        psm: 8,
      },

      {
        canvas:
          binary180,
        psm: 13,
      },
    ];

    const attempts = [];

    for (
      const config of
      configs
    ) {
      attempts.push(
        await recognizeVariant(
          worker,
          config.canvas,
          key,
          config.psm
        )
      );
    }

    const best =
      selectBestCandidate(
        attempts,
        key
      );

    return {
      value:
        best.value,

      warning:
        best.warning,

      attempts:
        attempts.map(
          (item) =>
            item.value
              ? `${item.value}(P${item.psm})`
              : `空(P${item.psm})`
        ),

      preview:
        raw.toDataURL(
          "image/jpeg",
          0.95
        ),
    };
  }

  /*
   * ==========================================
   * OCR開始
   * ==========================================
   */

  async function analyzeSelectedDays() {
    if (
      !images.length ||
      isAnalyzing
    ) {
      return;
    }

    const totalDays =
      Object.values(
        selectedDays
      ).reduce(
        (sum, days) =>
          sum + days.length,
        0
      );

    if (!totalDays) {
      setError(
        "診療日を選択してください"
      );

      return;
    }

    setResults([]);
    setError("");
    setElapsed(null);
    setProgress(0);
    setIsAnalyzing(true);

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
          1
        );

      const output = [];

      const totalCells =
        totalDays * 3;

      let completed = 0;

      for (
        let fileIndex = 0;
        fileIndex <
        images.length;
        fileIndex++
      ) {
        const image =
          images[fileIndex];

        const days =
          selectedDays[
            fileIndex
          ] || [];

        for (
          const day of days
        ) {
          const row = {
            id:
              `${fileIndex}-${day}`,

            fileIndex,

            fileName:
              files[
                fileIndex
              ]?.name || "",

            day,

            patients: "",
            insurance: "",
            care: "",

            warnings: {
              patients:
                false,

              insurance:
                false,

              care:
                false,
            },

            previews: {},
            attempts: {},
          };

          for (
            const key of [
              "patients",
              "insurance",
              "care",
            ]
          ) {
            setStatusText(
              `${fileIndex + 1}/${images.length}枚目　${day}日 ${COLUMNS[key].label} を解析中…`
            );

            const result =
              await recognizeCell(
                worker,
                image,
                day,
                key
              );

            row[key] =
              result.value;

            row.warnings[
              key
            ] =
              result.warning;

            row.previews[
              key
            ] =
              result.preview;

            row.attempts[
              key
            ] =
              result.attempts;

            completed++;

            setProgress(
              Math.round(
                (
                  completed /
                  totalCells
                ) *
                  100
              )
            );
          }

          output.push(row);
        }
      }

      output.sort(
        (a, b) => {
          if (
            a.day !== b.day
          ) {
            return (
              a.day -
              b.day
            );
          }

          return (
            a.fileIndex -
            b.fileIndex
          );
        }
      );

      setResults(output);

      setElapsed(
        (
          (
            performance.now() -
            started
          ) /
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
        "OCR解析中にエラーが発生しました"
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
   * ==========================================
   * 手修正
   * ==========================================
   */

  function updateCell(
    rowIndex,
    key,
    value
  ) {
    const cleaned =
      value.replace(
        /\D/g,
        ""
      );

    setResults(
      (current) =>
        current.map(
          (row, index) => {
            if (
              index !== rowIndex
            ) {
              return row;
            }

            return {
              ...row,

              [key]:
                cleaned,

              warnings: {
                ...row.warnings,

                [key]:
                  false,
              },
            };
          }
        )
    );
  }

  /*
   * ==========================================
   * 警告数
   * ==========================================
   */

  const warningCount =
    useMemo(() => {
      let count = 0;

      for (
        const row of results
      ) {
        for (
          const key of [
            "patients",
            "insurance",
            "care",
          ]
        ) {
          if (
            row.warnings[
              key
            ]
          ) {
            count++;
          }
        }
      }

      return count;
    }, [results]);

  /*
   * ==========================================
   * 日付ごとに合算
   * ==========================================
   */

  const mergedRows =
    useMemo(() => {
      const map = {};

      for (
        const row of results
      ) {
        if (!map[row.day]) {
          map[row.day] = {
            day:
              row.day,

            patients: 0,

            insurance: 0,

            care: 0,
          };
        }

        map[
          row.day
        ].patients +=
          Number(
            row.patients
          ) || 0;

        map[
          row.day
        ].insurance +=
          Number(
            row.insurance
          ) || 0;

        map[
          row.day
        ].care +=
          Number(
            row.care
          ) || 0;
      }

      return Object.values(
        map
      ).sort(
        (a, b) =>
          a.day - b.day
      );
    }, [results]);

  const totals =
    useMemo(() => {
      return mergedRows.reduce(
        (acc, row) => {
          acc.patients +=
            row.patients;

          acc.insurance +=
            row.insurance;

          acc.care +=
            row.care;

          return acc;
        },
        {
          patients: 0,
          insurance: 0,
          care: 0,
        }
      );
    }, [mergedRows]);

  const totalPoints =
    totals.insurance +
    totals.care;

  /*
   * ==========================================
   * Excel
   * ==========================================
   */

  function exportExcel() {
    if (!mergedRows.length) {
      return;
    }

    const data =
      mergedRows.map(
        (row) => ({
          日付:
            `${row.day}日`,

          曜日:
            getWeekdayLabel(
              row.day
            ),

          実患者:
            row.patients,

          保険診療分:
            row.insurance,

          介護保険:
            row.care,

          合計:
            row.insurance +
            row.care,
        })
      );

    data.push({
      日付: "合計",
      曜日: "",
      実患者:
        totals.patients,

      保険診療分:
        totals.insurance,

      介護保険:
        totals.care,

      合計:
        totalPoints,
    });

    const worksheet =
      XLSX.utils.json_to_sheet(
        data
      );

    worksheet["!cols"] = [
      { wch: 9 },
      { wch: 7 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
    ];

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      `${year}年${month}月`
    );

    XLSX.writeFile(
      workbook,
      `${year}年${month}月_診療日別集計.xlsx`
    );
  }

  /*
   * ==========================================
   * UI
   * ==========================================
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
          🔒 画像・OCR処理は端末内で行われます
        </div>

        {/* STEP 1 */}

        <section className="card">

          <span className="step">
            STEP 1
          </span>

          <h2>
            月と画像を選択
          </h2>

          <div
            style={{
              display: "flex",
              gap: "8px",
              marginBottom: "16px",
            }}
          >

            <select
              value={year}
              onChange={(e) =>
                setYear(
                  Number(
                    e.target.value
                  )
                )
              }
              style={selectStyle}
            >
              {Array.from(
                { length: 7 },
                (_, i) =>
                  now.getFullYear() -
                  3 +
                  i
              ).map((y) => (
                <option
                  key={y}
                  value={y}
                >
                  {y}年
                </option>
              ))}
            </select>

            <select
              value={month}
              onChange={(e) =>
                setMonth(
                  Number(
                    e.target.value
                  )
                )
              }
              style={selectStyle}
            >
              {Array.from(
                { length: 12 },
                (_, i) =>
                  i + 1
              ).map((m) => (
                <option
                  key={m}
                  value={m}
                >
                  {m}月
                </option>
              ))}
            </select>

          </div>

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
            ＋画像を選択
          </button>

          {files.length > 0 && (
            <div className="selected">

              <strong>
                {files.length}
                枚選択
              </strong>

              {files.map(
                (
                  file,
                  index
                ) => (
                  <div
                    key={index}
                    style={{
                      marginTop:
                        "5px",
                      fontSize:
                        "12px",
                    }}
                  >
                    {file.name}
                  </div>
                )
              )}

            </div>
          )}

        </section>

        {/* STEP 2 */}

        {images.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 2
            </span>

            <h2>
              診療日を選択
            </h2>

            <p className="description">
              カレンダー上で診療日をタップしてください。
            </p>

            {files.map(
              (
                file,
                fileIndex
              ) => {

                const days =
                  selectedDays[
                    fileIndex
                  ] || [];

                return (
                  <div
                    key={fileIndex}
                    style={{
                      marginTop:
                        fileIndex
                          ? "34px"
                          : "15px",
                    }}
                  >

                    <strong>
                      {file.name}
                    </strong>

                    <div
                      style={{
                        display:
                          "flex",
                        gap: "6px",
                        marginTop:
                          "10px",
                        marginBottom:
                          "12px",
                        flexWrap:
                          "wrap",
                      }}
                    >

                      <button
                        style={miniButton}
                        onClick={() =>
                          selectWeekdays(
                            fileIndex,
                            [1, 2, 4]
                          )
                        }
                      >
                        月・火・木
                      </button>

                      <button
                        style={miniButton}
                        onClick={() =>
                          selectWeekdays(
                            fileIndex,
                            [3, 5]
                          )
                        }
                      >
                        水・金
                      </button>

                      <button
                        style={miniButton}
                        onClick={() =>
                          clearDays(
                            fileIndex
                          )
                        }
                      >
                        クリア
                      </button>

                    </div>

                    <div
                      style={{
                        fontSize:
                          "12px",
                        marginBottom:
                          "10px",
                        color:
                          "#64748b",
                      }}
                    >
                      選択：
                      {days.length}
                      日
                    </div>

                    {/* 曜日ヘッダー */}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(7, 1fr)",
                        gap: "5px",
                        marginBottom:
                          "5px",
                      }}
                    >
                      {WEEKDAYS.map(
                        (
                          label,
                          index
                        ) => (
                          <div
                            key={label}
                            style={{
                              textAlign:
                                "center",
                              fontSize:
                                "12px",
                              fontWeight:
                                700,
                              color:
                                index === 0
                                  ? "#dc2626"
                                  : index === 6
                                  ? "#2563eb"
                                  : "#475569",
                            }}
                          >
                            {label}
                          </div>
                        )
                      )}
                    </div>

                    {/* カレンダー */}

                    <div
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "repeat(7, 1fr)",

                        gap: "5px",
                      }}
                    >

                      {Array.from(
                        {
                          length:
                            firstWeekday,
                        }
                      ).map(
                        (_, i) => (
                          <div
                            key={
                              `blank-${i}`
                            }
                          />
                        )
                      )}

                      {Array.from(
                        {
                          length:
                            daysInMonth,
                        },

                        (_, i) =>
                          i + 1
                      ).map(
                        (day) => {

                          const selected =
                            days.includes(
                              day
                            );

                          const wd =
                            getWeekday(
                              day
                            );

                          return (
                            <button
                              key={day}
                              onClick={() =>
                                toggleDay(
                                  fileIndex,
                                  day
                                )
                              }
                              style={{
                                aspectRatio:
                                  "1 / 1",

                                border:
                                  selected
                                    ? "2px solid #2563eb"
                                    : "1px solid #d4dbe4",

                                background:
                                  selected
                                    ? "#dbeafe"
                                    : wd === 0
                                    ? "#fff5f5"
                                    : wd === 6
                                    ? "#eff6ff"
                                    : "#fff",

                                color:
                                  selected
                                    ? "#1d4ed8"
                                    : wd === 0
                                    ? "#dc2626"
                                    : wd === 6
                                    ? "#2563eb"
                                    : "#1e293b",

                                borderRadius:
                                  "9px",

                                fontSize:
                                  "15px",

                                fontWeight:
                                  selected
                                    ? 700
                                    : 500,

                                padding: 0,
                              }}
                            >
                              {day}
                            </button>
                          );
                        }
                      )}

                    </div>

                  </div>
                );
              }
            )}

          </section>
        )}

        {/* STEP 3 */}

        {images.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 3
            </span>

            <h2>
              選択日をOCR
            </h2>

            <p className="description">
              複数の画像処理とOCR方式を使って
              数字候補を比較します。
            </p>

            <button
              className="select-button"
              disabled={isAnalyzing}
              onClick={
                analyzeSelectedDays
              }
            >
              {isAnalyzing
                ? "解析中…"
                : "選択した日を解析"}
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

                <div
                  style={{
                    marginTop:
                      "5px",
                    textAlign:
                      "right",
                    fontSize:
                      "12px",
                  }}
                >
                  {progress}%
                </div>

              </div>
            )}

            {elapsed && (
              <div className="selected">
                解析時間：
                <strong>
                  {elapsed}
                  秒
                </strong>
              </div>
            )}

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

          </section>
        )}

        {/* STEP 4 */}

        {results.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 4
            </span>

            <h2>
              読み取り結果を確認
            </h2>

            <div
              style={{
                padding:
                  "12px",

                borderRadius:
                  "10px",

                marginBottom:
                  "18px",

                fontWeight:
                  700,

                background:
                  warningCount
                    ? "#fff7d6"
                    : "#ecfdf5",

                border:
                  warningCount
                    ? "1px solid #facc15"
                    : "1px solid #86efac",
              }}
            >
              {warningCount
                ? `⚠️ 要確認：${warningCount}箇所`
                : "✓ 要確認箇所はありません"}
            </div>

            {results.map(
              (
                row,
                rowIndex
              ) => (
                <div
                  key={row.id}
                  style={{
                    border:
                      "1px solid #dbe3ea",

                    borderRadius:
                      "12px",

                    marginBottom:
                      "18px",

                    overflow:
                      "hidden",
                  }}
                >

                  <div
                    style={{
                      padding:
                        "10px 12px",

                      background:
                        "#eef6ff",
                    }}
                  >

                    <strong
                      style={{
                        fontSize:
                          "18px",
                      }}
                    >
                      {row.day}日（
                      {getWeekdayLabel(
                        row.day
                      )}
                      ）
                    </strong>

                    <div
                      style={{
                        fontSize:
                          "10px",

                        color:
                          "#64748b",

                        marginTop:
                          "2px",
                      }}
                    >
                      {row.fileName}
                    </div>

                  </div>

                  {[
                    "patients",
                    "insurance",
                    "care",
                  ].map(
                    (key) => {

                      const warning =
                        row.warnings[
                          key
                        ];

                      return (
                        <div
                          key={key}
                          style={{
                            padding:
                              "12px",

                            borderTop:
                              "1px solid #e2e8f0",

                            background:
                              warning
                                ? "#fffbea"
                                : "#fff",
                          }}
                        >

                          <div
                            style={{
                              fontSize:
                                "12px",

                              fontWeight:
                                700,

                              marginBottom:
                                "7px",
                            }}
                          >
                            {
                              COLUMNS[
                                key
                              ].label
                            }

                            {warning &&
                              " ⚠️ 要確認"}
                          </div>

                          <div
                            style={{
                              background:
                                "#fff",

                              border:
                                "1px solid #dbe3ea",

                              borderRadius:
                                "7px",

                              overflow:
                                "hidden",

                              padding:
                                "4px",
                            }}
                          >

                            <img
                              src={
                                row.previews[
                                  key
                                ]
                              }
                              alt=""
                              style={{
                                width:
                                  "100%",

                                height:
                                  "60px",

                                objectFit:
                                  "contain",

                                display:
                                  "block",
                              }}
                            />

                          </div>

                          <input
                            type="text"
                            inputMode="numeric"
                            value={
                              row[key]
                            }
                            placeholder="数字を入力"
                            onChange={
                              (e) =>
                                updateCell(
                                  rowIndex,
                                  key,
                                  e.target
                                    .value
                                )
                            }
                            style={{
                              width:
                                "100%",

                              boxSizing:
                                "border-box",

                              marginTop:
                                "8px",

                              padding:
                                "10px",

                              fontSize:
                                "20px",

                              textAlign:
                                "right",

                              border:
                                warning
                                  ? "2px solid #f59e0b"
                                  : "1px solid #cbd5e1",

                              borderRadius:
                                "8px",

                              background:
                                "#fff",
                            }}
                          />

                          <div
                            style={{
                              fontSize:
                                "10px",

                              color:
                                "#64748b",

                              marginTop:
                                "5px",

                              lineHeight:
                                "1.5",
                            }}
                          >
                            OCR候補：
                            {
                              row.attempts[
                                key
                              ].join(
                                " / "
                              )
                            }
                          </div>

                        </div>
                      );
                    }
                  )}

                </div>
              )
            )}

          </section>
        )}

        {/* STEP 5 */}

        {results.length > 0 && (
          <section className="card">

            <span className="step">
              STEP 5
            </span>

            <h2>
              集計
            </h2>

            <div
              style={{
                background:
                  "#eef6ff",

                padding:
                  "14px",

                borderRadius:
                  "10px",

                lineHeight:
                  "1.9",
              }}
            >

              <div>
                出勤日数：
                <strong>
                  {mergedRows.length}
                  日
                </strong>
              </div>

              <div>
                実患者：
                <strong>
                  {totals.patients}
                  人
                </strong>
              </div>

              <div>
                保険診療分：
                <strong>
                  {totals.insurance.toLocaleString()}
                </strong>
              </div>

              <div>
                介護保険：
                <strong>
                  {totals.care.toLocaleString()}
                </strong>
              </div>

              <div
                style={{
                  marginTop:
                    "5px",

                  fontSize:
                    "18px",
                }}
              >
                合計：
                <strong>
                  {totalPoints.toLocaleString()}
                </strong>
              </div>

            </div>

            <button
              className="select-button"
              style={{
                marginTop:
                  "18px",
              }}
              onClick={
                exportExcel
              }
            >
              Excelを作成
            </button>

          </section>
        )}

        <footer>
          半自動OCR 実用テスト版
        </footer>

      </section>

    </main>
  );
}

const miniButton = {
  border:
    "1px solid #cbd5e1",

  background:
    "#fff",

  borderRadius:
    "7px",

  padding:
    "7px 10px",

  fontSize:
    "11px",
};

const selectStyle = {
  flex: 1,

  padding:
    "10px",

  border:
    "1px solid #cbd5e1",

  borderRadius:
    "9px",

  background:
    "#fff",

  fontSize:
    "16px",
};