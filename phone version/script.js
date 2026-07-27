(() => {
  const STATUS = {
    ONTIME: ['On Time', 'ontime'],
    DELAYED: ['Delayed', 'delayed'],
    ARRIVING: ['Arriving', 'arriving'],
    STOPPED: ['Stopped', 'stopped'],
    OFFLINE: ['Offline', 'offline'],
  };
  const ROUTES = {
    101: { name: 'City Loop', direction: 'To Terminal', stops: ['Depot', 'Central Market', 'City Hall', 'Riverside', 'Terminal'] },
    204: { name: 'University Link', direction: 'To Exchange', stops: ['North Gate', 'University', 'Museum', 'Harbour', 'Exchange'] },
    305: { name: 'Airport Express', direction: 'To Old Town', stops: ['Airport', 'Tech Park', 'Library', 'Stadium', 'Old Town'] },
    402: { name: 'Riverside Connector', direction: 'To South Station', stops: ['West End', 'Riverside', 'Hospital', 'Market Square', 'South Station'] },
  };

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

  const get = (id) => document.getElementById(id);
  const elements = Object.fromEntries([
    'live', 'liveText', 'clock', 'date', 'fleetList', 'fleetCount',
  ].map((id) => [id, get(id)]));

  const fleet = new Map();

  // Firebase listeners - listen for all bus updates
  busesRef.on('child_added', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      fleet.set(data.bus, data);
      renderFleet();
    }
  });

  busesRef.on('child_changed', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      fleet.set(data.bus, data);
      renderFleet();
    }
  });

  function setText(element, value) {
    const text = String(value);
    if (element && element.textContent !== text) element.textContent = text;
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
      const progressLabel = document.createElement('span');
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
      progressLabel.className = 'fleet-progress-label';
      progressLabel.textContent = `${Math.round(progressValue)}%`;
      track.append(line, progress, busMarker);
      header.append(idLabel, nameLabel);
      detail.append(currentLabel, nextLabel, fareLabel, loadLabel, speedLabel, indexLabel);
      footer.append(eta, status);
      card.append(header, track, progressLabel, detail, footer);
      fragment.append(card);
    });
    elements.fleetList.replaceChildren(fragment);
    setText(elements.fleetCount, fleet.size);
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

  function updateClock() {
    const now = new Date();
    setText(elements.clock, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    setText(elements.date, now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }));
  }

  function setLiveState() {
    elements.live.classList.add('active');
    setText(elements.liveText, 'LIVE');
  }

  updateClock();
  setInterval(updateClock, 1_000);
  setLiveState();
  seedFleet();
})();
