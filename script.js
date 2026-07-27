/*
 * Metro Transit Link - Laptop Dashboard
 * Uses Firebase Realtime Database for cross-device sync
 */
(() => {
  const MAX_LOG_ENTRIES = 150;
  const STALE_AFTER_MS = 45_000;

  // Firebase Config
  const firebaseConfig = {
    apiKey: "AIzaSyDw2vYrA4N4xYzY8P8qR2sT3uV4wX5yZ6aA",
    authDomain: "metro-transit-link.firebaseapp.com",
    databaseURL: "https://metro-transit-link-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "metro-transit-link",
    storageBucket: "metro-transit-link.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123def456"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  const busesRef = db.ref('buses');
  const STATUS = {
    ONTIME: ['On Time', 'ontime', '+'],
    DELAYED: ['Delayed', 'delayed', '!'],
    ARRIVING: ['Arriving', 'arriving', '>'],
    STOPPED: ['Stopped', 'stopped', '|'],
    OFFLINE: ['Offline', 'offline', 'x'],
  };
  const ROUTES = {
    101: { name: 'City Loop', direction: 'To Terminal', stops: ['Depot', 'Central Market', 'City Hall', 'Riverside', 'Terminal'] },
    204: { name: 'University Link', direction: 'To Exchange', stops: ['North Gate', 'University', 'Museum', 'Harbour', 'Exchange'] },
    305: { name: 'Airport Express', direction: 'To Old Town', stops: ['Airport', 'Tech Park', 'Library', 'Stadium', 'Old Town'] },
    402: { name: 'Riverside Connector', direction: 'To South Station', stops: ['West End', 'Riverside', 'Hospital', 'Market Square', 'South Station'] },
  };

  const get = (id) => document.getElementById(id);
  const elements = Object.fromEntries([
    'connect', 'live', 'liveText', 'busNo', 'log', 'clearLog', 'clock', 'date', 'top',
    'demo', 'serviceNotice', 'fleetList', 'fleetCount',
  ].map((id) => [id, get(id)]));

  const displayedNumbers = new WeakMap();
  const animationFrames = new WeakMap();
  let port = null;
  let reader = null;
  let isReading = false;
  let isConnecting = false;
  let transportMode = 'offline';
  let demoTimer = null;
  let lastTelemetryAt = 0;
  let audioContext = null;
  const fleet = new Map();

  // Firebase listeners
  busesRef.on('child_changed', (snapshot) => {
    const data = snapshot.val();
    if (data) fleet.set(data.bus, data);
    renderFleet();
  });

  function setText(element, value) {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
  }

  function enableAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
  }

  function playArrivalChime() {
    if (!audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const noteStart = start + (index * 0.16);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.09, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.42);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.44);
    });
  }

  function cancelNumberAnimation(element) {
    const frame = animationFrames.get(element);
    if (frame) cancelAnimationFrame(frame);
    animationFrames.delete(element);
  }

  function animateNumber(element, target) {
    cancelNumberAnimation(element);
    const from = displayedNumbers.get(element) ?? (Number(element.textContent) || 0);
    const start = performance.now();
    const duration = 380;
    displayedNumbers.set(element, target);

    const render = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      element.textContent = Math.round(from + ((target - from) * progress));
      if (progress < 1) animationFrames.set(element, requestAnimationFrame(render));
      else animationFrames.delete(element);
    };
    animationFrames.set(element, requestAnimationFrame(render));
  }

  function addLog(message) {
    const line = document.createElement('div');
    const time = document.createElement('time');
    const code = document.createElement('code');
    line.className = 'logline';
    time.textContent = new Date().toLocaleTimeString();
    code.textContent = message;
    line.append(time, code);
    elements.log.append(line);

    while (elements.log.children.length > MAX_LOG_ENTRIES) elements.log.firstElementChild.remove();
    elements.log.scrollTop = elements.log.scrollHeight;
  }

  function setConnectionState(state) {
    const connected = state === 'connected';
    const connecting = state === 'connecting';
    const demo = state === 'demo';
    transportMode = state;
    elements.live.classList.toggle('active', connected);
    elements.connect.classList.toggle('connected', connected);
    elements.connect.disabled = connecting;
    elements.demo.classList.toggle('active', demo);
    elements.connect.setAttribute('aria-busy', String(connecting));
    elements.top.classList.toggle('is-offline', !connected && !connecting && !demo);
    elements.top.classList.toggle('is-connecting', connecting);
    elements.top.classList.toggle('is-demo', demo);
    setText(elements.liveText, connected ? 'LIVE' : connecting ? 'CONNECTING' : demo ? 'DEMO' : 'OFFLINE');
    setText(elements.connect, connected ? 'Disconnect' : connecting ? 'Connecting...' : 'Connect micro:bit');
    setText(elements.demo, demo ? 'Stop demo' : 'View demo');
    updateOperationalNotice();
  }

  function routeProfile(bus) {
    return ROUTES[bus] || {
      name: `Route ${bus}`,
      direction: 'Live service',
      stops: ['Origin', 'Stop 2', 'Stop 3', 'Stop 4', 'Terminal'],
    };
  }

  function renderFleet() {
    const fragment = document.createDocumentFragment();
    [...fleet.values()].sort((a, b) => a.bus.localeCompare(b.bus, undefined, { numeric: true })).forEach((data) => {
      const profile = routeProfile(data.bus);
      const card = document.createElement('article');
      const header = document.createElement('div');
      const idLabel = document.createElement('span');
      const nameLabel = document.createElement('span');
      const track = document.createElement('div');
      const line = document.createElement('div');
      const progress = document.createElement('div');
      const busMarker = document.createElement('div');
      const detail = document.createElement('div');
      const currentLabel = document.createElement('span');
      const nextLabel = document.createElement('span');
      const fareLabel = document.createElement('span');
      const loadLabel = document.createElement('span');
      const speedLabel = document.createElement('span');
      const indexLabel = document.createElement('span');
      const footer = document.createElement('div');
      const eta = document.createElement('span');
      const status = document.createElement('span');

      const safeIndex = Math.max(0, Math.min(profile.stops.length - 1, data.index));
      const progressValue = profile.stops.length > 1 ? (safeIndex / (profile.stops.length - 1)) * 100 : 0;

      card.className = 'fleet-card';
      header.className = 'fleet-card-header';
      idLabel.className = 'fleet-bus-id';
      nameLabel.className = 'fleet-card-name';
      track.className = 'fleet-track';
      line.className = 'fleet-line';
      progress.className = 'fleet-progress';
      busMarker.className = 'fleet-bus-marker';
      detail.className = 'fleet-detail-row';
      footer.className = 'fleet-meta';
      eta.className = 'fleet-eta';
      status.className = `fleet-status ${STATUS[data.status][1]}`;

      idLabel.textContent = `BUS ${data.bus}`;
      nameLabel.textContent = `${profile.name} • ${profile.direction}`;
      currentLabel.textContent = `Current: ${data.current}`;
      nextLabel.textContent = `Next: ${data.next}`;
      fareLabel.textContent = `Fare: ${data.fare}`;
      loadLabel.textContent = `Load: ${data.passengers}/${data.capacity}`;
      speedLabel.textContent = `Speed: ${data.speed} km/h`;
      indexLabel.textContent = `Stop: ${safeIndex + 1} / ${profile.stops.length}`;
      eta.textContent = data.eta === 0 ? 'Arriving' : `${data.eta} min`;
      status.textContent = STATUS[data.status][0];

      progress.style.width = `${progressValue}%`;
      busMarker.style.left = `${progressValue}%`;
      track.append(line, progress, busMarker);
      header.append(idLabel, nameLabel);
      detail.append(currentLabel, nextLabel, fareLabel, loadLabel, speedLabel, indexLabel);
      footer.append(eta, status);
      card.append(header, track, detail, footer);
      fragment.append(card);
    });
    elements.fleetList.replaceChildren(fragment);
    setText(elements.fleetCount, fleet.size);
  }

  function ingestTelemetry(data) {
    fleet.set(data.bus, data);
    lastTelemetryAt = Date.now();
    renderFleet();
    updateOperationalNotice();
    // Sync to Firebase
    busesRef.child(data.bus).set(data).catch(err => {
      console.error('Firebase sync error:', err);
      addLog(`Sync error: ${err.message}`);
    });
  }

  function updateOperationalNotice() {
    const isFresh = Date.now() - lastTelemetryAt <= STALE_AFTER_MS;
    if (transportMode === 'demo') setText(elements.serviceNotice, 'Demonstration data is running. Connect a micro:bit for live telemetry.');
    else if (transportMode === 'connected' && isFresh) setText(elements.serviceNotice, 'Live vehicle telemetry is current.');
    else if (transportMode === 'connected') setText(elements.serviceNotice, 'Connected. Waiting for a valid bus data packet.');
    else if (transportMode === 'connecting') setText(elements.serviceNotice, 'Requesting access to the micro:bit serial connection.');
    else setText(elements.serviceNotice, 'Connect a micro:bit to receive live vehicle telemetry.');
    elements.serviceNotice.classList.toggle('stale', transportMode === 'connected' && !isFresh);
  }

  function parseMessage(raw) {
    const fields = raw.trim().split(',').map((field) => field.trim());
    if (fields.length !== 11 || fields[0] !== 'BUS') return null;

    const [bus, eta, fare, passengers, capacity, speed, current, next, index, status] = [
      fields[1], Number(fields[2]), Number(fields[3]), Number(fields[4]),
      Number(fields[5]), Number(fields[6]), fields[7], fields[8],
      Number(fields[9]), fields[10].toUpperCase(),
    ];

    const numericValues = [eta, fare, passengers, capacity, speed, index];
    const wholeNumberValues = [eta, passengers, capacity, speed, index];
    if (!bus || !current || !next || !STATUS[status]
      || numericValues.some((value) => !Number.isFinite(value) || value < 0)
      || wholeNumberValues.some((value) => !Number.isInteger(value))) return null;

    return { bus, eta, fare, passengers, capacity, speed, current, next, index, status };
  }

  function handleLine(raw) {
    addLog(raw);
    const data = parseMessage(raw);
    if (data) ingestTelemetry(data);
    else addLog('Ignored malformed message');
  }

  async function closeConnection({ closePort = true, message } = {}) {
    const activeReader = reader;
    const activePort = port;
    isReading = false;
    reader = null;
    port = null;

    if (activeReader) await activeReader.cancel().catch(() => {});
    if (closePort && activePort) await activePort.close().catch(() => {});

    setConnectionState('offline');
    if (message) addLog(message);
  }

  async function readLoop(sourcePort) {
    const decoder = new TextDecoderStream();
    const pipeClosed = sourcePort.readable.pipeTo(decoder.writable);
    const streamReader = decoder.readable.getReader();
    reader = streamReader;
    let buffer = '';

    try {
      while (isReading && port === sourcePort) {
        const { value, done } = await streamReader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        lines.filter(Boolean).forEach(handleLine);
      }
    } catch (error) {
      if (isReading && port === sourcePort) addLog(`Read error: ${error.message}`);
    } finally {
      streamReader.releaseLock();
      await pipeClosed.catch(() => {});
      if (reader === streamReader) reader = null;
      if (isReading && port === sourcePort) await closeConnection({ closePort: false, message: 'Device stream ended' });
    }
  }

  async function connect(authorizedPort = null, isReconnect = false) {
    if (port || isConnecting) return;
    if (!('serial' in navigator)) {
      addLog('Web Serial requires Chrome or Edge over HTTPS or localhost.');
      return;
    }

    if (demoTimer) stopDemo(true);
    let selectedPort = null;
    isConnecting = true;
    setConnectionState('connecting');
    try {
      selectedPort = authorizedPort || await navigator.serial.requestPort();
      await selectedPort.open({ baudRate: 115200 });
      port = selectedPort;
      isReading = true;
      setConnectionState('connected');
      addLog(isReconnect ? 'Reconnected to authorized micro:bit' : 'Connected to micro:bit');
      void readLoop(selectedPort);
    } catch (error) {
      await selectedPort?.close().catch(() => {});
      setConnectionState('offline');
      addLog(`${isReconnect ? 'Reconnect' : 'Connection'} failed: ${error.message}`);
    } finally {
      isConnecting = false;
    }
  }

  async function disconnect() {
    await closeConnection({ message: 'Disconnected' });
  }

  function demoPacket(sequence) {
    const bus = ['101', '204', '305', '402'][sequence % 4];
    const profile = routeProfile(bus);
    const index = Math.floor(sequence / 4) % profile.stops.length;
    const passengers = 14 + ((sequence * 3) % 15);
    const eta = index === 4 ? 0 : Math.max(1, 6 - index);
    return {
      bus, eta, fare: bus === '305' ? 25 : 15, passengers, capacity: 30,
      speed: index === 4 ? 0 : 24 + ((sequence * 4) % 13),
      current: profile.stops[index], next: profile.stops[Math.min(index + 1, profile.stops.length - 1)],
      index, status: eta === 0 ? 'ARRIVING' : passengers > 24 ? 'DELAYED' : 'ONTIME',
    };
  }

  function stopDemo(silent = false) {
    if (!demoTimer) return;
    window.clearInterval(demoTimer);
    demoTimer = null;
    setConnectionState('offline');
    if (!silent) addLog('Demo telemetry stopped');
  }

  function startDemo() {
    if (port || isConnecting) {
      addLog('Disconnect the micro:bit before starting demo telemetry');
      return;
    }
    let sequence = 0;
    const renderDemoPacket = () => {
      const packet = demoPacket(sequence++);
      ingestTelemetry(packet);
      addLog(`DEMO,BUS,${packet.bus},${packet.eta},${packet.fare},${packet.passengers},${packet.capacity},${packet.speed},${packet.current},${packet.next},${packet.index},${packet.status}`);
    };
    setConnectionState('demo');
    renderDemoPacket();
    demoTimer = window.setInterval(renderDemoPacket, 2_500);
    addLog('Demo telemetry started');
  }

  function updateClock() {
    const now = new Date();
    setText(elements.clock, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setText(elements.date, now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }));
  }

  async function restoreAuthorizedPort() {
    if (!('serial' in navigator) || port || isConnecting || demoTimer) return;
    try {
      const [authorizedPort] = await navigator.serial.getPorts();
      if (authorizedPort) await connect(authorizedPort, true);
    } catch (error) {
      addLog(`Authorized device check failed: ${error.message}`);
    }
  }

  function seedFleet() {
    [
      { bus: '101', eta: 5, fare: 15, passengers: 18, capacity: 30, speed: 32, current: 'Central Market', next: 'City Hall', index: 1, status: 'ONTIME' },
      { bus: '204', eta: 2, fare: 15, passengers: 25, capacity: 30, speed: 27, current: 'University', next: 'Museum', index: 1, status: 'DELAYED' },
      { bus: '305', eta: 8, fare: 25, passengers: 10, capacity: 30, speed: 44, current: 'Airport', next: 'Tech Park', index: 0, status: 'ONTIME' },
      { bus: '402', eta: 1, fare: 15, passengers: 21, capacity: 30, speed: 18, current: 'Market Square', next: 'South Station', index: 3, status: 'ARRIVING' },
    ].forEach((data) => fleet.set(data.bus, data));
    renderFleet();
  }

  elements.connect.addEventListener('click', () => {
    enableAudio();
    return port ? disconnect() : connect();
  });
  elements.demo.addEventListener('click', () => {
    enableAudio();
    return demoTimer ? stopDemo() : startDemo();
  });
  elements.clearLog.addEventListener('click', () => { elements.log.replaceChildren(); });
  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target === port) {
        void closeConnection({ closePort: false, message: 'Device disconnected' });
        window.setTimeout(() => { void restoreAuthorizedPort(); }, 1500);
      }
    });
  }

  updateClock();
  setInterval(updateClock, 1_000);
  setInterval(updateOperationalNotice, 5_000);
  seedFleet();
  void restoreAuthorizedPort();
})();
