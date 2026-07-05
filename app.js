const tg = window.Telegram.WebApp;
tg.expand(); 

const urlParams = new URLSearchParams(window.location.search);
const botUsername = urlParams.get('bot') || "suchitha1bot"; 
const shortId = urlParams.get('id'); 
const dataUrl = urlParams.get('url');
const userLimit = parseInt(urlParams.get('limit')) || 10;

let movies = [];
let filteredMovies = [];
let currentPage = 1;
const itemsPerPage = 10;

let selectedItems = []; 
let managerSelectedIds = new Set(); 
let searchTimeout;

// Event Listeners
document.getElementById('searchInput').addEventListener('keyup', debouncedSearch);
document.getElementById('prevBtn').addEventListener('click', () => changePage(-1));
document.getElementById('nextBtn').addEventListener('click', () => changePage(1));
document.getElementById('continueBtn').addEventListener('click', () => switchTab('manager'));
document.getElementById('sortDrop').addEventListener('change', applySort);
document.getElementById('btn-reverse').addEventListener('click', reverseOrder);
document.getElementById('btn-reset').addEventListener('click', resetOrder);
document.getElementById('sendBtn').addEventListener('click', sendSelected);
document.getElementById('btn-move-top').addEventListener('click', () => moveMulti('top'));
document.getElementById('btn-move-bottom').addEventListener('click', () => moveMulti('bottom'));
document.getElementById('btn-remove-multi').addEventListener('click', removeMulti);
document.getElementById('btn-cancel-multi').addEventListener('click', clearManagerSelection);

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => switchTab(e.target.dataset.target));
});

function parseSize(sizeStr) {
    const units = {'B':1, 'KB':1024, 'MB':1048576, 'GB':1073741824, 'TB':1099511627776};
    const match = sizeStr.toUpperCase().match(/([\d.]+)\s*([A-Z]+)/);
    if(match && units[match[2]]) return parseFloat(match[1]) * units[match[2]];
    return 0;
}

function formatBytes(bytes) {
    if(bytes === 0) return '0 B';
    const k = 1024, dm = 2, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function loadCloudData() {
    try {
        const response = await fetch(decodeURIComponent(dataUrl), { cache: "force-cache" });
        const data = await response.json();
        
        let rawArray = [];
        if (data.ok && data.result && data.result.content) {
            let jsonString = "";
            data.result.content.forEach(p => { if (p.children && p.children[0]) jsonString += p.children[0]; });
            rawArray = JSON.parse(jsonString);
        } else {
            rawArray = data;
        }
        
        movies = rawArray.map((item, idx) => {
            const parts = item.split('|');
            return { 
                t: parts[0], 
                s: parts[1] || 'Unknown', 
                originalIndex: idx,
                sizeBytes: parseSize(parts[1] || '0 B')
            };
        });
        
        filteredMovies = movies;
        document.getElementById('loadingWrapper').style.display = 'none';
        document.getElementById('paginationBar').style.display = 'flex';
        document.getElementById('continueBtn').style.display = 'block';
        renderFilesList();
    } catch (e) {
        document.getElementById('loadingText').innerText = "❌ Error loading secure database.";
        document.querySelector('.spinner').style.display = 'none';
    }
}

function renderFilesList() {
    const container = document.getElementById('movie-list');
    container.innerHTML = ''; 
    const fragment = document.createDocumentFragment();
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paginatedItems = filteredMovies.slice(start, end);

    paginatedItems.forEach(movie => {
        const div = document.createElement('div');
        div.className = 'card';
        const isSelected = selectedItems.some(m => m.originalIndex === movie.originalIndex);
        
        div.innerHTML = `
            <label class="checkbox-container">
                <input type="checkbox" value="${movie.originalIndex}" ${isSelected ? 'checked' : ''} onchange="toggleFileSelection(this)">
                <div class="movie-info">
                    <span class="movie-title">${movie.t}</span>
                    <span class="movie-size">${movie.s}</span>
                </div>
            </label>
        `;
        fragment.appendChild(div);
    });

    container.appendChild(fragment);
    document.getElementById('pageInfo').innerText = `Page ${currentPage} of ${Math.ceil(filteredMovies.length / itemsPerPage) || 1}`;
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = end >= filteredMovies.length;
    updateContinueButton();
}

function changePage(direction) {
    currentPage += direction;
    renderFilesList();
}

function debouncedSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const queryText = document.getElementById('searchInput').value.toLowerCase();
        const queryWords = queryText.split(' ').filter(w => w !== '');
        if (queryWords.length === 0) filteredMovies = movies;
        else {
            filteredMovies = movies.filter(m => {
                const titleLower = m.t.toLowerCase();
                return queryWords.every(word => titleLower.includes(word));
            });
        }
        currentPage = 1;
        renderFilesList();
    }, 150);
}

window.toggleFileSelection = function(checkbox) {
    const id = parseInt(checkbox.value);
    if (checkbox.checked) {
        if (selectedItems.length >= userLimit) {
            checkbox.checked = false; 
            tg.showAlert(`⚠️ Tier Limit Reached!\n\nYour current plan limits you to a maximum of ${userLimit} files per batch.\n\nPlease upgrade to a higher VIP plan to unlock larger batches!`);
            return;
        }
        
        const movie = movies.find(m => m.originalIndex === id);
        if(movie && !selectedItems.some(m => m.originalIndex === id)) selectedItems.push(movie);
    } else {
        selectedItems = selectedItems.filter(m => m.originalIndex !== id);
        managerSelectedIds.delete(id); 
    }
    updateContinueButton();
    checkToolbarVisibility();
}

function updateContinueButton() {
    document.getElementById('continueBtn').innerText = `Continue (${selectedItems.length} / ${userLimit})`;
    document.getElementById('nav-manager').innerText = `⭐ Queue (${selectedItems.length})`;
}

function renderManager() {
    const container = document.getElementById('manager-list');
    container.innerHTML = '';
    
    const totalBytes = selectedItems.reduce((acc, curr) => acc + curr.sizeBytes, 0);
    document.getElementById('mgr-count').innerText = `${selectedItems.length} / ${userLimit} Files`;
    document.getElementById('mgr-size').innerText = formatBytes(totalBytes);

    if(selectedItems.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--text-muted); margin-top:20px; font-weight: 500;">Your queue is empty.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    selectedItems.forEach((movie) => {
        const div = document.createElement('div');
        div.className = 'card';
        // HTML5 drag removed; replaced with SortableJS below

        const isChecked = managerSelectedIds.has(movie.originalIndex) ? 'checked' : '';

        div.innerHTML = `
            <div class="drag-handle">☰</div>
            <label class="checkbox-container">
                <input type="checkbox" value="${movie.originalIndex}" ${isChecked} onchange="toggleManagerSelection(this)">
                <div class="movie-info">
                    <span class="movie-title">${movie.t}</span>
                    <span class="movie-size">${movie.s}</span>
                </div>
            </label>
            <button class="remove-btn" onclick="removeSingle(${movie.originalIndex})">❌</button>
        `;
        fragment.appendChild(div);
    });
    container.appendChild(fragment);

    // 🚀 NEW: Initialize SortableJS for smooth mobile dragging
    Sortable.create(container, {
        handle: '.drag-handle', // Only drag via the ☰ icon
        animation: 150, // Smooth slide effect
        ghostClass: 'sortable-ghost',
        onEnd: function (evt) {
            const movedItem = selectedItems.splice(evt.oldIndex, 1)[0];
            selectedItems.splice(evt.newIndex, 0, movedItem);
            document.getElementById('sortDrop').value = 'manual';
        }
    });

    checkToolbarVisibility();
}

window.removeSingle = function(id) {
    selectedItems = selectedItems.filter(m => m.originalIndex !== id);
    managerSelectedIds.delete(id);
    renderManager();
    updateContinueButton();
    renderFilesList(); 
}

function applySort() {
    const val = document.getElementById('sortDrop').value;
    if(val === 'size') selectedItems.sort((a, b) => b.sizeBytes - a.sizeBytes);
    renderManager();
}

function reverseOrder() {
    selectedItems.reverse();
    document.getElementById('sortDrop').value = 'manual';
    renderManager();
}

function resetOrder() {
    selectedItems.sort((a, b) => a.originalIndex - b.originalIndex);
    document.getElementById('sortDrop').value = 'manual';
    renderManager();
}

window.toggleManagerSelection = function(checkbox) {
    const id = parseInt(checkbox.value);
    if(checkbox.checked) managerSelectedIds.add(id);
    else managerSelectedIds.delete(id);
    checkToolbarVisibility();
}

function checkToolbarVisibility() {
    const tb = document.getElementById('multiToolbar');
    if(managerSelectedIds.size > 0 && document.getElementById('tab-manager').classList.contains('active')) {
        tb.classList.add('active');
    } else {
        tb.classList.remove('active');
    }
}

function clearManagerSelection() {
    managerSelectedIds.clear();
    renderManager();
}

function moveMulti(direction) {
    const toMove = selectedItems.filter(m => managerSelectedIds.has(m.originalIndex));
    const rest = selectedItems.filter(m => !managerSelectedIds.has(m.originalIndex));
    
    if(direction === 'top') selectedItems = [...toMove, ...rest];
    else selectedItems = [...rest, ...toMove];
    
    document.getElementById('sortDrop').value = 'manual';
    clearManagerSelection();
}

function removeMulti() {
    selectedItems = selectedItems.filter(m => !managerSelectedIds.has(m.originalIndex));
    clearManagerSelection();
    updateContinueButton();
    renderFilesList();
}

function renderPreview() {
    const container = document.getElementById('preview-list');
    container.innerHTML = '';
    
    if(selectedItems.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); width:100%; text-align:center; font-weight: 500;">No files queued.</div>';
        return;
    }

    let html = '';
    selectedItems.forEach((m, idx) => {
        html += `
            <div class="preview-item">
                <span class="preview-num">${idx + 1}.</span>
                <span style="word-break: break-word; font-weight: 600;">${m.t} <br><span style="color:var(--accent-color); font-size:0.8rem; font-weight:bold;">${m.s}</span></span>
            </div>
        `;
    });
    container.innerHTML = html;
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tabId}`).classList.add('active');
    document.getElementById(`nav-${tabId}`).classList.add('active');
    
    if(tabId === 'files') renderFilesList();
    if(tabId === 'manager') renderManager();
    if(tabId === 'preview') renderPreview();
    
    checkToolbarVisibility();
}

async function sendSelected() {
    if (selectedItems.length === 0) {
        tg.showAlert("No files queued for delivery!");
        return;
    }
    if (selectedItems.length > userLimit) {
        tg.showAlert(`You exceeded your limit of ${userLimit} files. Please remove some files or upgrade to VIP.`);
        return;
    }

    const indicesArray = selectedItems.map(m => m.originalIndex);
    
    const btn = document.getElementById('sendBtn');
    btn.innerText = "🔄 Processing...";
    btn.disabled = true;

    if (indicesArray.length <= 10) {
        const encoded = indicesArray.join('-');
        const deepLink = `https://t.me/${botUsername}?start=blks_${shortId}_${encoded}`;
        tg.openTelegramLink(deepLink);
        setTimeout(() => { tg.close(); }, 150); 
    } else {
        let cloudId = "";
        try {
            const response = await fetch("https://api.npoint.io/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(indicesArray)
            });
            const data = await response.json();
            cloudId = data.id;
        } catch (e) {
            try {
                const response = await fetch("https://dpaste.com/api/v2/", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: "content=" + encodeURIComponent(JSON.stringify(indicesArray)) + "&syntax=json"
                });
                const urlText = await response.text();
                const cleanUrl = urlText.trim().replace(".txt", "").replace(/\/$/, ""); 
                const parts = cleanUrl.split('/');
                cloudId = parts[parts.length - 1]; 
            } catch (e2) {
                tg.showAlert("Network error. Please try again.");
                btn.innerText = `📤 Send Securely`;
                btn.disabled = false;
                return;
            }
        }

        const deepLink = `https://t.me/${botUsername}?start=blkc_${shortId}_${cloudId}`;
        tg.openTelegramLink(deepLink);
        setTimeout(() => { tg.close(); }, 150); 
    }
}

// Start sequence
loadCloudData();
