// PPG Signal V-Lab core logic
// Handles navigation, real dataset visualization, and the Experiment 01 simulator.

const LAB_VIEWS = {
  "home-view": document.getElementById("home-view"),
  "experiments-view": document.getElementById("experiments-view"),
  "experiment-01": document.getElementById("experiment-01"),
  "experiment-02": document.getElementById("experiment-02"),
  "experiment-03": document.getElementById("experiment-03"),
  "about-view": document.getElementById("about-view")
};

const NAV_BUTTONS = Array.from(document.querySelectorAll("[data-nav]"));
const OPEN_BUTTONS = Array.from(document.querySelectorAll("[data-open-view]"));

const PPG_DEFAULTS = {
  heartRate: 72,
  amplitude: 1,
  noise: 0,
  baselineWander: 0,
  duration: 5,
  samplingRate: 125
};

const SIGNAL_STATE = {
  heartRate: PPG_DEFAULTS.heartRate,
  amplitude: PPG_DEFAULTS.amplitude,
  noise: PPG_DEFAULTS.noise,
  baselineWander: PPG_DEFAULTS.baselineWander,
  duration: PPG_DEFAULTS.duration,
  samplingRate: PPG_DEFAULTS.samplingRate,
  generatedSignal: [],
  timeVector: []
};

const EXP2_STATE = {
  originalSignal: [],
  originalTime: [],
  originalChart: null,
  resultChart: null
};

const EXP3_DEFAULT_SAMPLE_COUNT = 5;
const EXP3_STATE = {
  inputSignal: [],
  impulseResponse: [],
  outputSignal: [],
  inputChart: null,
  impulseChart: null,
  outputChart: null
};

function setActiveView(viewId, updateHash = true) {
  const normalizedViewId = LAB_VIEWS[viewId] ? viewId : "home-view";

  Object.entries(LAB_VIEWS).forEach(([key, section]) => {
    if (section) {
      section.classList.toggle("active", key === normalizedViewId);
    }
  });

  NAV_BUTTONS.forEach((button) => {
    const isActive = button.dataset.nav === normalizedViewId;
    button.classList.toggle("active", isActive);
  });

  const experimentCards = document.querySelectorAll("[data-open-view]");
  experimentCards.forEach((button) => {
    button.classList.remove("active");
  });

  const activeSelection = document.querySelector(`[data-open-view="${normalizedViewId}"]`);
  if (activeSelection) {
    activeSelection.classList.add("active");
  }

  if (updateHash && window.location.hash !== `#${normalizedViewId}`) {
    window.location.hash = `#${normalizedViewId}`;
  }
}

function attachNavigationHandlers() {
  NAV_BUTTONS.forEach((button) => {
    button.addEventListener("click", () => {
      const targetView = button.dataset.nav;
      setActiveView(targetView);
    });
  });

  OPEN_BUTTONS.forEach((button) => {
    button.addEventListener("click", () => {
      const viewId = button.dataset.openView;
      setActiveView(viewId);
    });
  });

  window.addEventListener("hashchange", () => {
    setActiveView(window.location.hash.slice(1), false);
  });
}

function createFallbackChartData(length = 220) {
  return Array.from({ length }, (_, index) => {
    const base = Math.sin(index / 18) * 0.7;
    return Number((base + Math.sin(index / 7) * 0.4).toFixed(4));
  });
}

function getRealPpgSeries(length = 400) {
  const dataset = globalThis.PPG_DATA || window.PPG_DATA;
  if (dataset && Array.isArray(dataset.normalized)) {
    return dataset.normalized.slice(0, length);
  }

  return createFallbackChartData(length);
}

function getRealPpgTimeVector(length = 400) {
  const dataset = globalThis.PPG_DATA || window.PPG_DATA;
  const samplingRate = dataset && typeof dataset.samplingRate === "number"
    ? dataset.samplingRate
    : 125;

  return Array.from({ length }, (_, index) => Number((index / samplingRate).toFixed(4)));
}

function getPpgSampleInterval(time) {
  return time.length > 1 ? time[1] - time[0] : 1 / 125;
}

function interpolateSignal(signal, samplePosition) {
  if (!Number.isFinite(samplePosition) || samplePosition < 0 || samplePosition > signal.length - 1) {
    return 0;
  }

  const lowerIndex = Math.floor(samplePosition);
  const upperIndex = Math.min(lowerIndex + 1, signal.length - 1);
  const fraction = samplePosition - lowerIndex;
  return signal[lowerIndex] + (signal[upperIndex] - signal[lowerIndex]) * fraction;
}

// Reverse both the samples and their transformed time coordinates for x(-t).
function applyTimeReversal(signal, time) {
  return {
    signal: signal.slice().reverse(),
    time: time.slice().reverse().map((sampleTime) => -sampleTime)
  };
}

// Translate sample coordinates right for positive t0, matching x(t - t0).
function applyTimeShift(signal, time, shift) {
  return {
    signal: signal.slice(),
    time: time.map((sampleTime) => sampleTime + shift)
  };
}

// Sample x(a*t) on the original output grid using linear interpolation and zero extension.
function applyTimeScaling(signal, time, factor) {
  const sampleInterval = getPpgSampleInterval(time);
  const transformedSignal = time.map((outputTime) => {
    const sourceTime = outputTime * factor;
    const sourcePosition = (sourceTime - time[0]) / sampleInterval;
    return interpolateSignal(signal, sourcePosition);
  });

  return { signal: transformedSignal, time: time.slice() };
}

// Apply a scalar to every sampled amplitude.
function applyAmplitudeScaling(signal, factor) {
  return signal.map((sample) => sample * factor);
}

function applyAddition(signal, referenceSignal) {
  return signal.map((sample, index) => sample + referenceSignal[index]);
}

function applySubtraction(signal, referenceSignal) {
  return signal.map((sample, index) => sample - referenceSignal[index]);
}

function applyMultiplication(signal, referenceSignal) {
  return signal.map((sample, index) => sample * referenceSignal[index]);
}

function createDelayedPpgReference(signal, time, delay = 0.25) {
  const sampleInterval = getPpgSampleInterval(time);
  return time.map((sampleTime) => {
    const sourcePosition = (sampleTime - delay - time[0]) / sampleInterval;
    return interpolateSignal(signal, sourcePosition);
  });
}

function formatShiftExpression(shift) {
  return shift >= 0
    ? `y(t) = x(t - ${shift.toFixed(2)})`
    : `y(t) = x(t + ${Math.abs(shift).toFixed(2)})`;
}

function describeExperiment02Operation(operation, shift, factor) {
  switch (operation) {
    case "time-reversal":
      return ["y(t) = x(-t)", "Signal is reversed along the time axis."];
    case "time-shift":
      return [formatShiftExpression(shift), `Signal shifted ${shift >= 0 ? "right" : "left"} by ${shift >= 0 ? "+" : ""}${shift.toFixed(2)} s.`];
    case "time-scaling":
      return [factor === 1 ? "y(t) = x(t)" : `y(t) = x(${factor.toFixed(1)}t)`, factor > 1
        ? `Signal compressed by a factor of ${factor.toFixed(1)}.`
        : factor < 1
          ? `Signal expanded by a factor of ${(1 / factor).toFixed(1)}.`
          : "Signal duration is unchanged."];
    case "amplitude-scaling":
      return [`y(t) = ${factor.toFixed(2)}x(t)`, factor === 1
        ? "Amplitude is unchanged because the scale factor is 1.00."
        : `Amplitude multiplied by ${factor.toFixed(2)}.`];
    case "addition":
      return ["y(t) = x1(t) + x2(t)", "Added the PPG signal to a 0.25 s delayed copy of itself."];
    case "subtraction":
      return ["y(t) = x1(t) - x2(t)", "Subtracted a 0.25 s delayed copy of the PPG signal."];
    case "multiplication":
      return ["y(t) = x1(t) × x2(t)", "Multiplied the PPG signal by a 0.25 s delayed copy of itself."];
    default:
      return ["y(t) = x(t)", "Original PPG signal."];
  }
}

function renderExperiment02Result() {
  const selectedOperation = document.querySelector('input[name="signal-operation"]:checked');
  const operation = selectedOperation ? selectedOperation.value : "amplitude-scaling";
  const shift = Number(document.getElementById("shiftValue").value);
  const factor = Number(document.getElementById("scaleValue").value);
  let result = { signal: EXP2_STATE.originalSignal.slice(), time: EXP2_STATE.originalTime.slice() };

  switch (operation) {
    case "time-reversal":
      result = applyTimeReversal(EXP2_STATE.originalSignal, EXP2_STATE.originalTime);
      break;
    case "time-shift":
      result = applyTimeShift(EXP2_STATE.originalSignal, EXP2_STATE.originalTime, shift);
      break;
    case "time-scaling":
      result = applyTimeScaling(EXP2_STATE.originalSignal, EXP2_STATE.originalTime, factor);
      break;
    case "amplitude-scaling":
      result.signal = applyAmplitudeScaling(EXP2_STATE.originalSignal, factor);
      break;
    case "addition": {
      const reference = createDelayedPpgReference(EXP2_STATE.originalSignal, EXP2_STATE.originalTime);
      result.signal = applyAddition(EXP2_STATE.originalSignal, reference);
      break;
    }
    case "subtraction": {
      const reference = createDelayedPpgReference(EXP2_STATE.originalSignal, EXP2_STATE.originalTime);
      result.signal = applySubtraction(EXP2_STATE.originalSignal, reference);
      break;
    }
    case "multiplication": {
      const reference = createDelayedPpgReference(EXP2_STATE.originalSignal, EXP2_STATE.originalTime);
      result.signal = applyMultiplication(EXP2_STATE.originalSignal, reference);
      break;
    }
  }

  const [equation, explanation] = describeExperiment02Operation(operation, shift, factor);
  document.getElementById("shiftDisplay").textContent = `${shift.toFixed(2)} s`;
  document.getElementById("scaleDisplay").textContent = factor.toFixed(1);
  document.getElementById("shiftParameterRow").hidden = operation !== "time-shift";
  document.getElementById("scaleParameterRow").hidden = operation !== "time-scaling" && operation !== "amplitude-scaling";
  document.getElementById("operationEquation").textContent = equation;
  document.getElementById("operationExplanation").textContent = explanation;

  if (EXP2_STATE.resultChart) {
    EXP2_STATE.resultChart.data.datasets[0].data = result.signal.map((sample, index) => ({ x: result.time[index], y: sample }));
    EXP2_STATE.resultChart.update("none");
  }

  return result;
}

function resetExperiment02() {
  document.querySelector('input[name="signal-operation"][value="amplitude-scaling"]').checked = true;
  document.getElementById("shiftValue").value = "0";
  document.getElementById("scaleValue").value = "1";
  renderExperiment02Result();
}

function attachExperiment02Handlers() {
  document.querySelectorAll('input[name="signal-operation"]').forEach((input) => {
    input.addEventListener("change", renderExperiment02Result);
  });
  document.getElementById("shiftValue").addEventListener("input", renderExperiment02Result);
  document.getElementById("scaleValue").addEventListener("input", renderExperiment02Result);
  document.getElementById("exp2SimulateBtn").addEventListener("click", renderExperiment02Result);
  document.getElementById("exp2ResetBtn").addEventListener("click", resetExperiment02);
}

function generateImpulseResponse(sampleCount) {
  const validSampleCount = Math.max(1, Math.floor(Number(sampleCount)));
  return Array.from({ length: validSampleCount }, () => 1 / validSampleCount);
}

// Compute full linear convolution by summing every overlapping sample pair.
function discreteConvolution(inputSignal, impulseResponse) {
  const outputSignal = Array(inputSignal.length + impulseResponse.length - 1).fill(0);

  inputSignal.forEach((inputSample, inputIndex) => {
    impulseResponse.forEach((responseSample, responseIndex) => {
      outputSignal[inputIndex + responseIndex] += inputSample * responseSample;
    });
  });

  return outputSignal;
}

function updateConvolutionSampleDisplay() {
  const sampleCount = Number(document.getElementById("kernelLength").value);
  document.getElementById("convolutionSampleCount").textContent = sampleCount.toString();
  document.getElementById("convolutionReciprocal").textContent =
    `N = ${sampleCount} → each sample of h[n] = 1/${sampleCount}`;
}

function updateConvolutionStatistics() {
  const outputSignal = EXP3_STATE.outputSignal;
  const maximum = Math.max(...outputSignal);
  const minimum = Math.min(...outputSignal);
  const mean = outputSignal.reduce((sum, sample) => sum + sample, 0) / outputSignal.length;

  document.getElementById("convolutionInputLength").textContent = EXP3_STATE.inputSignal.length.toString();
  document.getElementById("convolutionInfoSampleCount").textContent = EXP3_STATE.impulseResponse.length.toString();
  document.getElementById("convolutionOutputLength").textContent = outputSignal.length.toString();
  document.getElementById("convolutionMaximum").textContent = maximum.toFixed(3);
  document.getElementById("convolutionMinimum").textContent = minimum.toFixed(3);
  document.getElementById("convolutionMean").textContent = mean.toFixed(3);
}

function updateConvolutionExplanation() {
  const sampleCount = EXP3_STATE.impulseResponse.length;
  const outputLength = EXP3_STATE.outputSignal.length;
  document.getElementById("convolutionExplanation").textContent =
    `For N = ${sampleCount}, each impulse-response sample is 1/${sampleCount}. The moving-average response smooths the real PPG signal; linear convolution produces ${outputLength} output samples.`;
}

function updateConvolutionCharts() {
  const sampleCount = Number(document.getElementById("kernelLength").value);
  EXP3_STATE.impulseResponse = generateImpulseResponse(sampleCount);
  EXP3_STATE.outputSignal = discreteConvolution(EXP3_STATE.inputSignal, EXP3_STATE.impulseResponse);
  updateConvolutionSampleDisplay();

  const inputPoints = EXP3_STATE.inputSignal.map((sample, index) => ({ x: index, y: sample }));
  const impulsePoints = EXP3_STATE.impulseResponse.map((sample, index) => ({ x: index, y: sample }));
  const outputPoints = EXP3_STATE.outputSignal.map((sample, index) => ({ x: index, y: sample }));

  EXP3_STATE.inputChart.data.datasets[0].data = inputPoints;
  EXP3_STATE.impulseChart.data.datasets[0].data = impulsePoints;
  EXP3_STATE.outputChart.data.datasets[0].data = outputPoints;
  EXP3_STATE.inputChart.update("none");
  EXP3_STATE.impulseChart.update("none");
  EXP3_STATE.outputChart.update("none");

  updateConvolutionStatistics();
  updateConvolutionExplanation();
}

function resetConvolutionExperiment() {
  document.getElementById("kernelLength").value = EXP3_DEFAULT_SAMPLE_COUNT;
  updateConvolutionCharts();
}

function initializeConvolutionExperiment() {
  const dataset = globalThis.PPG_DATA || window.PPG_DATA;
  EXP3_STATE.inputSignal = dataset && Array.isArray(dataset.normalized)
    ? dataset.normalized.slice()
    : getRealPpgSeries(220);
  const sampleIndices = Array.from({ length: EXP3_STATE.inputSignal.length }, (_, index) => index);

  EXP3_STATE.inputChart = initChart("convInputChart", sampleIndices, EXP3_STATE.inputSignal, {
    borderColor: "#5ee7ff",
    backgroundColor: "rgba(94, 231, 255, 0.10)",
    xDisplay: true,
    yDisplay: true,
    xType: "linear",
    xTitle: "Sample Index",
    yTitle: "Amplitude"
  });
  EXP3_STATE.impulseChart = initChart("convKernelChart", [0, 1, 2, 3, 4], generateImpulseResponse(EXP3_DEFAULT_SAMPLE_COUNT), {
    borderColor: "#7cf0c4",
    backgroundColor: "rgba(124, 240, 196, 0.10)",
    xDisplay: true,
    yDisplay: true,
    xType: "linear",
    xTitle: "Sample Index",
    yTitle: "Amplitude"
  });
  EXP3_STATE.outputChart = initChart("convOutputChart", [], [], {
    borderColor: "#6c8bff",
    backgroundColor: "rgba(108, 139, 255, 0.12)",
    xDisplay: true,
    yDisplay: true,
    xType: "linear",
    xTitle: "Sample Index",
    yTitle: "Amplitude"
  });

  document.getElementById("kernelLength").value = EXP3_DEFAULT_SAMPLE_COUNT;
  updateConvolutionCharts();
}

function attachConvolutionHandlers() {
  document.getElementById("kernelLength").addEventListener("input", updateConvolutionSampleDisplay);
  document.getElementById("simulateConvolutionBtn").addEventListener("click", updateConvolutionCharts);
  document.getElementById("resetConvolutionBtn").addEventListener("click", resetConvolutionExperiment);
}

function initChart(canvasId, labels, series, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const { borderColor = "#5ee7ff", backgroundColor = "rgba(94, 231, 255, 0.16)", yDisplay = false, xDisplay = false, xType = "category", xTitle = "Time (s)", yTitle = "Amplitude" } = options;
  const chartSeries = xType === "linear"
    ? series.map((value, index) => ({ x: labels[index], y: value }))
    : series;

  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "PPG",
          data: chartSeries,
          borderColor,
          backgroundColor,
          borderWidth: 2.5,
          pointRadius: 0,
          tension: xType === "linear" ? 0 : 0.34,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: "nearest" },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        x: {
          type: xType,
          display: xDisplay,
          title: {
            display: xDisplay,
            text: xTitle
          },
          grid: {
            color: "rgba(94, 231, 255, 0.08)"
          }
        },
        y: {
          display: yDisplay,
          title: {
            display: yDisplay,
            text: yTitle
          },
          grid: {
            color: "rgba(94, 231, 255, 0.08)"
          }
        }
      }
    }
  });
}

function updateSliderDisplay() {
  const heartRate = Number(document.getElementById("heartRateSlider").value);
  const amplitude = Number(document.getElementById("amplitudeSlider").value);
  const noise = Number(document.getElementById("noiseSlider").value);
  const baselineWander = Number(document.getElementById("baselineSlider").value);
  const duration = Number(document.getElementById("durationSlider").value);
  const samplingRate = Number(document.getElementById("samplingRateSlider").value);

  document.getElementById("heartRateValue").textContent = `${heartRate} BPM`;
  document.getElementById("amplitudeValue").textContent = amplitude.toFixed(2);
  document.getElementById("noiseValue").textContent = noise.toFixed(2);
  document.getElementById("baselineValue").textContent = baselineWander.toFixed(2);
  document.getElementById("durationValue").textContent = `${duration.toFixed(1)} s`;
  document.getElementById("samplingRateValue").textContent = `${samplingRate} Hz`;

  SIGNAL_STATE.heartRate = heartRate;
  SIGNAL_STATE.amplitude = amplitude;
  SIGNAL_STATE.noise = noise;
  SIGNAL_STATE.baselineWander = baselineWander;
  SIGNAL_STATE.duration = duration;
  SIGNAL_STATE.samplingRate = samplingRate;
}

function generateNoise(length, noiseLevel) {
  return Array.from({ length }, () => (Math.random() - 0.5) * noiseLevel * 2);
}

function generateBaselineWander(timeVector, wanderAmplitude) {
  const wanderFrequency = 0.25;
  return timeVector.map((time) => wanderAmplitude * Math.sin(2 * Math.PI * wanderFrequency * time));
}

function generatePPG() {
  const { heartRate, amplitude, noise, baselineWander, duration, samplingRate } = SIGNAL_STATE;
  const pulseFrequency = heartRate / 60;
  const sampleCount = Math.max(1, Math.round(duration * samplingRate));
  const timeVector = Array.from({ length: sampleCount }, (_, index) => index / samplingRate);

  const waveform = timeVector.map((time) => {
    const cycle = time % (1 / pulseFrequency);
    const phase = cycle / (1 / pulseFrequency);

    const systolic = Math.exp(-Math.pow((phase - 0.18) / 0.11, 2)) * 1.2;
    const diastolic = Math.exp(-Math.pow((phase - 0.55) / 0.18, 2)) * 0.35;
    const notch = Math.exp(-Math.pow((phase - 0.44) / 0.035, 2)) * -0.15;
    const lateDiastolic = Math.exp(-Math.pow((phase - 0.72) / 0.16, 2)) * 0.12;

    return Math.max(0, systolic + diastolic + notch + lateDiastolic);
  });

  const normalizedWaveform = waveform.map((sample) => sample * amplitude);
  const baseline = generateBaselineWander(timeVector, baselineWander);
  const noiseVector = generateNoise(sampleCount, noise);
  const finalSignal = normalizedWaveform.map((sample, index) => sample + baseline[index] + noiseVector[index]);

  SIGNAL_STATE.generatedSignal = finalSignal;
  SIGNAL_STATE.timeVector = timeVector;

  return {
    signal: finalSignal,
    time: timeVector,
    sampleCount,
    pulseFrequency,
    mean: finalSignal.reduce((sum, value) => sum + value, 0) / sampleCount
  };
}

function calculateSignalStatistics(signal) {
  const mean = signal.reduce((sum, value) => sum + value, 0) / signal.length;
  const max = Math.max(...signal);
  const min = Math.min(...signal);
  const peakToPeak = max - min;

  return {
    mean,
    max,
    min,
    peakToPeak
  };
}

function updatePPGStats(signal) {
  const stats = calculateSignalStatistics(signal);
  const heartRate = Number(document.getElementById("heartRateSlider").value);
  const samplingRate = Number(document.getElementById("samplingRateSlider").value);
  const duration = Number(document.getElementById("durationSlider").value);

  document.getElementById("simHeartRate").textContent = `${heartRate} BPM`;
  document.getElementById("simSamplingRate").textContent = `${samplingRate} Hz`;
  document.getElementById("simDuration").textContent = `${duration.toFixed(1)} s`;
  document.getElementById("simSamples").textContent = signal.length.toString();
  document.getElementById("simFrequency").textContent = `${(heartRate / 60).toFixed(2)} Hz`;
  document.getElementById("simMean").textContent = stats.mean.toFixed(3);
  document.getElementById("simMax").textContent = stats.max.toFixed(3);
  document.getElementById("simMin").textContent = stats.min.toFixed(3);
  document.getElementById("simPeakPeak").textContent = stats.peakToPeak.toFixed(3);
}

function updateGeneratedSignalChart() {
  const signal = SIGNAL_STATE.generatedSignal;
  const time = SIGNAL_STATE.timeVector;

  if (!signal.length || !time.length) {
    return;
  }

  const downsampleFactor = Math.max(1, Math.floor(signal.length / 250));
  const sampleSubset = [];
  const timeSubset = [];

  for (let i = 0; i < signal.length; i += downsampleFactor) {
    sampleSubset.push(signal[i]);
    timeSubset.push(time[i]);
  }

  if (window.generatedPpgChart && window.generatedPpgChart instanceof Chart && typeof window.generatedPpgChart.destroy === "function") {
    window.generatedPpgChart.destroy();
  }

  window.generatedPpgChart = initChart("generatedPpgChart", timeSubset, sampleSubset, {
    borderColor: "#7cf0c4",
    backgroundColor: "rgba(124, 240, 196, 0.12)",
    xDisplay: true,
    yDisplay: true
  });
}

function updateRealDatasetChart() {
  const datasetSignal = getRealPpgSeries(500);
  const datasetTime = getRealPpgTimeVector(datasetSignal.length);

  if (window.realDatasetChart && window.realDatasetChart instanceof Chart && typeof window.realDatasetChart.destroy === "function") {
    window.realDatasetChart.destroy();
  }

  window.realDatasetChart = initChart("datasetChart", datasetTime, datasetSignal, {
    borderColor: "#5ee7ff",
    backgroundColor: "rgba(94, 231, 255, 0.10)",
    xDisplay: true,
    yDisplay: true
  });
}

function generatePPGFromControls() {
  updateSliderDisplay();
  const { signal } = generatePPG();
  updatePPGStats(signal);
  updateGeneratedSignalChart();
}

function resetSimulation() {
  document.getElementById("heartRateSlider").value = PPG_DEFAULTS.heartRate;
  document.getElementById("amplitudeSlider").value = PPG_DEFAULTS.amplitude;
  document.getElementById("noiseSlider").value = PPG_DEFAULTS.noise;
  document.getElementById("baselineSlider").value = PPG_DEFAULTS.baselineWander;
  document.getElementById("durationSlider").value = PPG_DEFAULTS.duration;
  document.getElementById("samplingRateSlider").value = PPG_DEFAULTS.samplingRate;

  updateSliderDisplay();
  generatePPGFromControls();
}

function downloadCSV() {
  const signal = SIGNAL_STATE.generatedSignal;
  const time = SIGNAL_STATE.timeVector;

  if (!signal.length || !time.length) {
    generatePPGFromControls();
  }

  const csvRows = ["time,amplitude"];
  signal.forEach((value, index) => {
    csvRows.push(`${time[index].toFixed(3)},${value.toFixed(6)}`);
  });

  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ppg_signal.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function attachSimulatorHandlers() {
  [
    "heartRateSlider",
    "amplitudeSlider",
    "noiseSlider",
    "baselineSlider",
    "durationSlider",
    "samplingRateSlider"
  ].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      updateSliderDisplay();
      generatePPGFromControls();
    });
  });

  document.getElementById("generatePPGBtn").addEventListener("click", generatePPGFromControls);
  document.getElementById("resetPPGBtn").addEventListener("click", resetSimulation);
  document.getElementById("downloadCsvBtn").addEventListener("click", downloadCSV);
}

function initCharts() {
  const heroSignal = getRealPpgSeries(300);
  initChart("heroWaveChart", Array.from({ length: heroSignal.length }, (_, i) => i), heroSignal, {
    borderColor: "#5ee7ff",
    backgroundColor: "rgba(94, 231, 255, 0.10)"
  });

  updateRealDatasetChart();

  const dataset = globalThis.PPG_DATA || window.PPG_DATA;
  EXP2_STATE.originalSignal = dataset && Array.isArray(dataset.normalized)
    ? dataset.normalized.slice()
    : getRealPpgSeries(220);
  EXP2_STATE.originalTime = getRealPpgTimeVector(EXP2_STATE.originalSignal.length);
  EXP2_STATE.originalChart = initChart("exp2OriginalChart", EXP2_STATE.originalTime, EXP2_STATE.originalSignal, {
    borderColor: "#5ee7ff",
    backgroundColor: "rgba(94, 231, 255, 0.10)",
    xDisplay: true,
    yDisplay: true,
    xType: "linear"
  });

  EXP2_STATE.resultChart = initChart("exp2ResultChart", EXP2_STATE.originalTime, EXP2_STATE.originalSignal, {
    borderColor: "#ffcf5a",
    backgroundColor: "rgba(255, 207, 90, 0.10)",
    xDisplay: true,
    yDisplay: true,
    xType: "linear"
  });
  renderExperiment02Result();

  initializeConvolutionExperiment();
}

function initializeApp() {
  attachNavigationHandlers();
  attachSimulatorHandlers();
  attachExperiment02Handlers();
  attachConvolutionHandlers();
  updateSliderDisplay();

  const initialView = window.location.hash.replace("#", "") || "home-view";
  setActiveView(initialView || "home-view");

  initCharts();
  generatePPGFromControls();
}

window.addEventListener("DOMContentLoaded", initializeApp);
