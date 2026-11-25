const sortingScene = document.querySelector("[data-tilt-scene]");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (sortingScene && !reduceMotion) {
  sortingScene.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const bounds = sortingScene.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
    const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
    sortingScene.style.setProperty("--tilt-x", `${horizontal * 12}deg`);
    sortingScene.style.setProperty("--tilt-y", `${vertical * -9}deg`);
    sortingScene.style.setProperty("--planet-x", `${horizontal * 15}px`);
    sortingScene.style.setProperty("--planet-y", `${vertical * 12}px`);
  });
  sortingScene.addEventListener("pointerleave", () => {
    ["--tilt-x", "--tilt-y", "--planet-x", "--planet-y"].forEach((property) => sortingScene.style.removeProperty(property));
  });
}

const canvas = document.getElementById("maze-canvas");

if (canvas) {
  const context = canvas.getContext("2d");
  const mapCanvas = document.getElementById("map-canvas");
  const mapContext = mapCanvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cellsWide = 19;
  const cellsHigh = 19;
  const mapWidth = cellsWide * 2 + 1;
  const mapHeight = cellsHigh * 2 + 1;
  const timeLimit = 150;
  const start = { x: 1, y: 1 };
  const finish = { x: mapWidth - 2, y: mapHeight - 2 };
  const player = { x: start.x + 0.5, y: start.y + 0.5, angle: 0 };
  const keys = new Set();
  const depthBuffer = new Float32Array(width);
  const fieldOfView = 0.66;
  const mapPanel = document.getElementById("map-panel");
  const mapToggle = document.getElementById("map-toggle");
  let maze = [];
  let gameState = "ready";
  let lastFrame = 0;
  let startTime = 0;
  let elapsedTime = 0;
  let steps = 0;
  let lastCell = `${start.x},${start.y}`;
  let pointerIsDown = false;
  let lastPointerX = 0;
  let lastHudUpdate = 0;

  const startOverlay = document.getElementById("start-overlay");
  const pauseOverlay = document.getElementById("pause-overlay");
  const finishOverlay = document.getElementById("finish-overlay");
  const pauseButton = document.getElementById("pause-button");
  const gameMessage = document.getElementById("game-message");
  const timeValue = document.getElementById("time-value");

  function makeMaze() {
    const visited = Array.from({ length: cellsHigh }, () => Array(cellsWide).fill(false));
    const stack = [{ x: 0, y: 0 }];
    const cells = Array.from({ length: cellsHigh }, () => Array(cellsWide).fill(0));
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    visited[0][0] = true;

    while (stack.length) {
      const current = stack[stack.length - 1];
      const options = directions
        .map(([dx, dy]) => ({ x: current.x + dx, y: current.y + dy, dx, dy }))
        .filter((next) => next.x >= 0 && next.x < cellsWide && next.y >= 0 && next.y < cellsHigh && !visited[next.y][next.x]);

      if (!options.length) {
        stack.pop();
        continue;
      }

      const firstStep = stack.length === 1 && current.x === 0 && current.y === 0;
      const next = firstStep
        ? options.find((option) => option.x === 1 && option.y === 0) || options[0]
        : options[Math.floor(Math.random() * options.length)];
      cells[current.y][current.x] = 1;
      cells[next.y][next.x] = 1;
      visited[next.y][next.x] = true;
      stack.push(next);
    }

    const result = Array.from({ length: mapHeight }, () => Array(mapWidth).fill(1));
    for (let y = 0; y < cellsHigh; y++) {
      for (let x = 0; x < cellsWide; x++) {
        if (!cells[y][x]) continue;
        result[y * 2 + 1][x * 2 + 1] = 0;
        if (x + 1 < cellsWide && cells[y][x + 1]) result[y * 2 + 1][x * 2 + 2] = 0;
        if (y + 1 < cellsHigh && cells[y + 1][x]) result[y * 2 + 2][x * 2 + 1] = 0;
      }
    }
    return result;
  }

  function formatTime(seconds) {
    const remaining = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  }

  function updateHud() {
    const remaining = Math.max(0, timeLimit - elapsedTime);
    timeValue.textContent = formatTime(remaining);
    timeValue.classList.toggle("time-low", gameState === "playing" && remaining <= 15);
    document.getElementById("steps-value").textContent = String(steps).padStart(3, "0");
  }

  function drawMap() {
    const cell = mapCanvas.width / mapWidth;
    mapContext.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    mapContext.fillStyle = "#18252b";
    mapContext.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        mapContext.fillStyle = maze[y][x] ? "#4c5d5e" : "#1d3033";
        mapContext.fillRect(x * cell, y * cell, cell + 0.25, cell + 0.25);
      }
    }

    mapContext.fillStyle = "#9ae6bd";
    mapContext.fillRect(start.x * cell + 1, (start.y + 0.43) * cell, cell - 2, Math.max(2, cell * 0.14));
    mapContext.fillStyle = "#17302a";
    mapContext.font = `bold ${Math.max(7, cell * 0.58)}px sans-serif`;
    mapContext.textAlign = "center";
    mapContext.textBaseline = "middle";
    mapContext.fillText("S", (start.x + 0.5) * cell, (start.y + 0.5) * cell);

    mapContext.fillStyle = "#ffcc7b";
    mapContext.fillRect(finish.x * cell + 1, finish.y * cell + 1, cell - 2, cell - 2);
    mapContext.fillStyle = "#362817";
    mapContext.fillText("F", (finish.x + 0.5) * cell, (finish.y + 0.5) * cell);

    const px = player.x * cell;
    const py = player.y * cell;
    mapContext.beginPath();
    mapContext.moveTo(px + Math.cos(player.angle) * cell * 0.8, py + Math.sin(player.angle) * cell * 0.8);
    mapContext.lineTo(px + Math.cos(player.angle + 2.45) * cell * 0.62, py + Math.sin(player.angle + 2.45) * cell * 0.62);
    mapContext.lineTo(px + Math.cos(player.angle - 2.45) * cell * 0.62, py + Math.sin(player.angle - 2.45) * cell * 0.62);
    mapContext.closePath();
    mapContext.fillStyle = "#f4fff1";
    mapContext.fill();
    mapContext.beginPath();
    mapContext.arc(px, py, Math.max(2.5, cell * 0.22), 0, Math.PI * 2);
    mapContext.fillStyle = "#91dfbd";
    mapContext.fill();
  }

  function toggleMap() {
    mapPanel.hidden = !mapPanel.hidden;
    const isOpen = !mapPanel.hidden;
    mapToggle.setAttribute("aria-expanded", String(isOpen));
    mapToggle.innerHTML = `<span aria-hidden="true">▦</span> ${isOpen ? "Hide map" : "Show map"}`;
    if (isOpen) drawMap();
  }

  function canOccupy(x, y) {
    const radius = 0.18;
    return [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]]
      .every(([offsetX, offsetY]) => maze[Math.floor(y + offsetY)]?.[Math.floor(x + offsetX)] === 0);
  }

  function movePlayer(deltaTime) {
    const forward = Number(keys.has("w") || keys.has("arrowup")) - Number(keys.has("s") || keys.has("arrowdown"));
    const strafe = Number(keys.has("d")) - Number(keys.has("a"));
    const turn = Number(keys.has("arrowright")) - Number(keys.has("arrowleft"));
    player.angle += turn * 2.15 * deltaTime;
    if (turn && !mapPanel.hidden) drawMap();
    if (!forward && !strafe) return;

    const directionX = Math.cos(player.angle);
    const directionY = Math.sin(player.angle);
    const distance = 2.35 * deltaTime / (Math.hypot(forward, strafe) || 1);
    const dx = (directionX * forward - directionY * strafe) * distance;
    const dy = (directionY * forward + directionX * strafe) * distance;
    if (canOccupy(player.x + dx, player.y)) player.x += dx;
    if (canOccupy(player.x, player.y + dy)) player.y += dy;

    const cell = `${Math.floor(player.x)},${Math.floor(player.y)}`;
    if (cell !== lastCell) {
      steps += 1;
      lastCell = cell;
      if (!mapPanel.hidden) drawMap();
    }

    if (Math.hypot(player.x - (finish.x + 0.5), player.y - (finish.y + 0.5)) < 0.42) completeMaze(true);
  }

  function castRay(rayX, rayY) {
    let mapX = Math.floor(player.x);
    let mapY = Math.floor(player.y);
    const deltaX = Math.abs(1 / (rayX || 1e-12));
    const deltaY = Math.abs(1 / (rayY || 1e-12));
    const stepX = rayX < 0 ? -1 : 1;
    const stepY = rayY < 0 ? -1 : 1;
    let sideX = (rayX < 0 ? player.x - mapX : mapX + 1 - player.x) * deltaX;
    let sideY = (rayY < 0 ? player.y - mapY : mapY + 1 - player.y) * deltaY;
    let side = 0;

    for (let count = 0; count < 88; count++) {
      if (sideX < sideY) {
        sideX += deltaX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += deltaY;
        mapY += stepY;
        side = 1;
      }
      if (maze[mapY]?.[mapX] === 1) break;
    }

    const distance = Math.max(0.08, side === 0 ? sideX - deltaX : sideY - deltaY);
    const wall = side === 0 ? player.y + distance * rayY : player.x + distance * rayX;
    return { distance, side, offset: wall - Math.floor(wall) };
  }

  function drawGround() {
    const horizon = height * 0.48;
    const sky = context.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#263e43");
    sky.addColorStop(0.72, "#66817a");
    sky.addColorStop(1, "#c2a983");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, horizon);

    const floor = context.createLinearGradient(0, horizon, 0, height);
    floor.addColorStop(0, "#625e50");
    floor.addColorStop(0.4, "#93816a");
    floor.addColorStop(1, "#c2a47d");
    context.fillStyle = floor;
    context.fillRect(0, horizon, width, height - horizon);

    const light = context.createRadialGradient(width * 0.5, horizon + 16, 5, width * 0.5, horizon + 16, width * 0.58);
    light.addColorStop(0, "#ffe4a11e");
    light.addColorStop(1, "#ffe4a100");
    context.fillStyle = light;
    context.fillRect(0, horizon, width, height - horizon);

    context.strokeStyle = "#322f2c29";
    context.lineWidth = 1;
    for (let index = 1; index <= 18; index++) {
      const ratio = index / 18;
      const y = horizon + (height - horizon) * ratio * ratio;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    for (let index = -19; index <= 19; index++) {
      context.beginPath();
      context.moveTo(width / 2, horizon);
      context.lineTo(width / 2 + index * width / 22, height);
      context.stroke();
    }
  }

  function drawWall(x, hit, stripeWidth) {
    const wallHeight = Math.min(height * 2, height / hit.distance);
    const top = Math.floor(height * 0.48 - wallHeight * 0.5);
    const bottom = Math.ceil(height * 0.48 + wallHeight * 0.5);
    const shade = Math.max(0.25, 1 - hit.distance * 0.047) * (hit.side ? 0.75 : 1);
    const stripe = Math.floor(hit.offset * 16) % 4 === 0 ? 1.04 : 0.97;
    const base = Math.floor(hit.offset * 8) % 2 ? [89, 134, 139] : [98, 147, 147];
    const color = base.map((value) => Math.min(255, Math.floor(value * shade * stripe)));
    context.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    context.fillRect(x, top, stripeWidth + 1, bottom - top);
    if (Math.floor(hit.offset * 10) % 5 === 0) {
      context.fillStyle = `rgba(222,239,213,${shade * 0.2})`;
      context.fillRect(x, top + wallHeight * 0.74, stripeWidth + 1, Math.max(1, wallHeight * 0.008));
    }
    context.fillStyle = `rgba(14,24,28,${Math.min(0.5, hit.distance * 0.026)})`;
    context.fillRect(x, top, stripeWidth + 1, bottom - top);
    depthBuffer[x] = hit.distance;
    if (x + 1 < width) depthBuffer[x + 1] = hit.distance;
  }

  function drawLandmark(x, y, label, tint) {
    const directionX = Math.cos(player.angle);
    const directionY = Math.sin(player.angle);
    const planeX = -directionY * fieldOfView;
    const planeY = directionX * fieldOfView;
    const inverse = 1 / (planeX * directionY - directionX * planeY);
    const offsetX = x - player.x;
    const offsetY = y - player.y;
    const transformX = inverse * (directionY * offsetX - directionX * offsetY);
    const transformY = inverse * (-planeY * offsetX + planeX * offsetY);
    if (transformY <= 0.15) return;
    const centerX = Math.floor(width / 2 * (1 + transformX / transformY));
    if (centerX < 4 || centerX >= width - 4 || transformY > depthBuffer[centerX]) return;

    const gateHeight = Math.min(height * 0.78, height / transformY * 0.92);
    const gateWidth = Math.min(width * 0.28, gateHeight * 1.18);
    const baseY = height * 0.48 + height * 0.34 / transformY;
    const topY = baseY - gateHeight;
    context.save();
    context.shadowColor = tint;
    context.shadowBlur = Math.min(24, 11 / transformY);
    context.fillStyle = label === "FINISH" ? "#d09e55" : "#65bd96";
    context.fillRect(centerX - gateWidth * 0.43, topY + gateHeight * 0.12, gateWidth * 0.12, gateHeight * 0.88);
    context.fillRect(centerX + gateWidth * 0.31, topY + gateHeight * 0.12, gateWidth * 0.12, gateHeight * 0.88);
    context.fillRect(centerX - gateWidth * 0.53, topY + gateHeight * 0.08, gateWidth * 1.06, gateHeight * 0.2);
    context.shadowBlur = 0;
    context.fillStyle = "#fff8de";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `bold ${Math.max(9, Math.min(19, gateHeight * 0.15))}px "DM Mono", monospace`;
    context.fillText(label, centerX, topY + gateHeight * 0.18);
    context.restore();
  }

  function renderScene() {
    drawGround();
    const directionX = Math.cos(player.angle);
    const directionY = Math.sin(player.angle);
    const planeX = -directionY * fieldOfView;
    const planeY = directionX * fieldOfView;
    const stripeWidth = 2;
    for (let x = 0; x < width; x += stripeWidth) {
      const cameraX = 2 * x / width - 1;
      drawWall(x, castRay(directionX + planeX * cameraX, directionY + planeY * cameraX), stripeWidth);
    }
    drawLandmark(start.x + 1.5, start.y + 0.5, "START", "#9ae6bd");
    drawLandmark(finish.x + 0.5, finish.y + 0.5, "FINISH", "#ffcc7b");
  }

  function completeMaze(won) {
    gameState = won ? "won" : "lost";
    elapsedTime = won ? (performance.now() - startTime) / 1000 : timeLimit;
    updateHud();
    pauseButton.disabled = true;
    keys.clear();
    const eyebrow = document.getElementById("finish-eyebrow");
    const title = document.getElementById("finish-title");
    const button = document.getElementById("again-button");
    if (won) {
      document.getElementById("status-label").textContent = "FINISH LINE CROSSED";
      eyebrow.textContent = "MAZE COMPLETE";
      title.innerHTML = "You found<br><em>your way out!</em>";
      document.getElementById("finish-message").textContent = `You made it in ${formatTime(elapsedTime)} with ${steps} steps.`;
      gameMessage.textContent = "You found the way through. Nice run!";
      button.innerHTML = 'Run a new maze <span aria-hidden="true">↻</span>';
    } else {
      document.getElementById("status-label").textContent = "TIME IS UP";
      eyebrow.textContent = "CHALLENGE OVER";
      title.innerHTML = "The clock<br><em>ran out.</em>";
      document.getElementById("finish-message").textContent = "The finish is still out there. Try another run!";
      gameMessage.textContent = "Time ran out. You can try a fresh maze.";
      button.innerHTML = 'Try a new maze <span aria-hidden="true">↻</span>';
    }
    finishOverlay.hidden = false;
  }

  function gameLoop(now) {
    const deltaTime = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (gameState === "playing") {
      movePlayer(deltaTime);
      if (gameState === "playing") {
        elapsedTime = (now - startTime) / 1000;
        if (elapsedTime >= timeLimit) completeMaze(false);
        else if (now - lastHudUpdate > 100) {
          updateHud();
          lastHudUpdate = now;
        }
      }
    }
    renderScene();
    if (!mapPanel.hidden) drawMap();
    requestAnimationFrame(gameLoop);
  }

  function enterMaze() {
    gameState = "playing";
    elapsedTime = 0;
    startTime = performance.now();
    steps = 0;
    lastCell = `${start.x},${start.y}`;
    startOverlay.hidden = true;
    pauseOverlay.hidden = true;
    finishOverlay.hidden = true;
    pauseButton.disabled = false;
    document.getElementById("status-label").textContent = "FIND THE FINISH";
    gameMessage.textContent = "Cross the start stripe, follow the corridors, find the gold finish gate.";
    updateHud();
    canvas.focus();
  }

  function resetMaze() {
    maze = makeMaze();
    player.x = start.x + 0.5;
    player.y = start.y + 0.5;
    player.angle = 0;
    elapsedTime = 0;
    steps = 0;
    lastCell = `${start.x},${start.y}`;
    gameState = "ready";
    keys.clear();
    pauseButton.disabled = true;
    document.getElementById("status-label").textContent = "READY AT THE START";
    startOverlay.hidden = false;
    pauseOverlay.hidden = true;
    finishOverlay.hidden = true;
    document.getElementById("start-button").innerHTML = 'Enter the maze <span aria-hidden="true">↗</span>';
    gameMessage.textContent = "A fresh maze is ready. Find the start stripe and reach the finish.";
    updateHud();
    if (!mapPanel.hidden) drawMap();
  }

  function togglePause() {
    if (gameState === "playing") {
      gameState = "paused";
      keys.clear();
      pauseOverlay.hidden = false;
      document.getElementById("status-label").textContent = "PAUSED";
      pauseButton.innerHTML = '<span aria-hidden="true">▶</span> Resume';
    } else if (gameState === "paused") {
      gameState = "playing";
      startTime = performance.now() - elapsedTime * 1000;
      pauseOverlay.hidden = true;
      document.getElementById("status-label").textContent = "FIND THE FINISH";
      pauseButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
    }
  }

  function handleKeyDown(event) {
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      keys.add(key);
      event.preventDefault();
    } else if (key === "escape" && (gameState === "playing" || gameState === "paused")) {
      togglePause();
    } else if (key === "m") {
      toggleMap();
    }
  }

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || gameState !== "playing") return;
    pointerIsDown = true;
    lastPointerX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", () => { pointerIsDown = false; });
  canvas.addEventListener("pointercancel", () => { pointerIsDown = false; });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerIsDown || gameState !== "playing") return;
    player.angle += (event.clientX - lastPointerX) * 0.004;
    lastPointerX = event.clientX;
  });
  document.querySelectorAll("[data-hold]").forEach((button) => {
    const key = button.dataset.hold;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      keys.add(key);
      button.setPointerCapture(event.pointerId);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
      button.addEventListener(eventName, () => keys.delete(key));
    });
  });

  document.getElementById("start-button").addEventListener("click", enterMaze);
  document.getElementById("resume-button").addEventListener("click", togglePause);
  document.getElementById("again-button").addEventListener("click", resetMaze);
  pauseButton.addEventListener("click", togglePause);
  document.getElementById("reset-button").addEventListener("click", resetMaze);
  mapToggle.addEventListener("click", () => {
    mapPanel.hidden = !mapPanel.hidden;
    const isOpen = !mapPanel.hidden;
    mapToggle.setAttribute("aria-expanded", String(isOpen));
    mapToggle.innerHTML = `<span aria-hidden="true">▦</span> ${isOpen ? "Hide map" : "Show map"}`;
    if (isOpen) drawMap();
  });

  maze = makeMaze();
  updateHud();
  lastFrame = performance.now();
  requestAnimationFrame(gameLoop);
}
