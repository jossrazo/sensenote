// SenseNote (formerly Mark2Link) - Popup Script
// Manages the highlight viewer and snippet management interface

(function () {
  "use strict";

  let allHighlights = [];
  let currentFilters = {
    favoriteOnly: false,
    color: 'all',
    category: 'all',
    dateSort: 'newest' // 'newest' or 'oldest'
  };

  // DOM elements
  const highlightsContainer = document.getElementById("highlights-container");
  const emptyState = document.getElementById("empty-state");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const searchBtn = document.getElementById("search-btn");
  const filterBtn = document.getElementById("filter-btn");
  const settingsBtn = document.getElementById("settings-btn");

  // Initialize
  function init() {
    loadHighlights();
    setupEventListeners();
  }

  // Setup event listeners
  function setupEventListeners() {
    clearAllBtn.addEventListener("click", handleClearAll);
    searchBtn.addEventListener("click", handleSearch);
    filterBtn.addEventListener("click", handleFilter);
    settingsBtn.addEventListener("click", handleSettings);

    // Close dropdowns when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest('.highlight-actions')) {
        document.querySelectorAll('.card-dropdown').forEach(d => d.classList.add('hidden'));
      }
    });
  }

  // Load highlights from storage
  function loadHighlights() {
    chrome.storage.local.get(["highlights"], function (result) {
      allHighlights = result.highlights || [];
      renderHighlights();
    });
  }

  // Render highlights
  function renderHighlights() {
    highlightsContainer.innerHTML = "";

    // Apply filters
    let filteredHighlights = [...allHighlights];

    // Filter by favorite
    if (currentFilters.favoriteOnly) {
      filteredHighlights = filteredHighlights.filter(h => h.favorite === true);
    }

    // Filter by color
    if (currentFilters.color !== 'all') {
      filteredHighlights = filteredHighlights.filter(h => h.color === currentFilters.color);
    }

    // Filter by category
    if (currentFilters.category !== 'all') {
      filteredHighlights = filteredHighlights.filter(h => h.category === currentFilters.category);
    }

    // Sort by date
    if (currentFilters.dateSort === 'newest') {
      filteredHighlights.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } else {
      filteredHighlights.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    // Show empty state if no highlights
    if (filteredHighlights.length === 0) {
      emptyState.style.display = "flex";
      if (allHighlights.length > 0) {
        // Show filtered empty state
        emptyState.querySelector('h2').textContent = 'No matches found';
        emptyState.querySelector('p').textContent = 'Try adjusting your filters.';
      } else {
        // Show default empty state
        emptyState.querySelector('h2').textContent = 'No highlights yet';
        emptyState.querySelector('p').textContent = 'Start highlighting text on any webpage to save it here.';
      }
      return;
    }

    emptyState.style.display = "none";

    // Render each highlight
    filteredHighlights.forEach((highlight) => {
      const card = createHighlightCard(highlight);
      highlightsContainer.appendChild(card);
    });
  }

  // Create highlight card element
  function createHighlightCard(highlight) {
    const card = document.createElement("div");
    card.className = "highlight-card";
    card.setAttribute("data-highlight-id", highlight.id);

    // Determine color class
    const colorClass = getColorClass(highlight.color);
    card.classList.add(colorClass);

    // Format date
    const date = new Date(highlight.timestamp);
    const formattedDate = formatDate(date);

    // Truncate URL for display
    const displayUrl = new URL(highlight.url).hostname;

    // Build card HTML
    card.innerHTML = `
      <div class="highlight-header">
        <a href="${highlight.url}" class="page-title" title="${highlight.pageTitle}">
          ${escapeHtml(highlight.pageTitle)}
        </a>
        <div class="highlight-actions">
          <button class="action-btn menu-btn" title="Options">
            <img src="icons/ellipsis-vertical.svg" alt="Menu" class="menu-icon">
          </button>
          <div class="card-dropdown hidden">
            <button class="dropdown-item favorite-btn">
              <span class="dropdown-icon">${highlight.favorite ? '★' : '☆'}</span>
              <span>${highlight.favorite ? 'Remove from favorites' : 'Add to favorites'}</span>
            </button>
            <button class="dropdown-item edit-btn">
              <span class="dropdown-icon">✏️</span>
              <span>Edit</span>
            </button>
            <button class="dropdown-item delete-btn">
              <span class="dropdown-icon">🗑️</span>
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>

      ${highlight.category ? `<span class="highlight-category">${escapeHtml(highlight.category)}</span>` : ''}

      <div class="highlight-text">${escapeHtml(highlight.text)}</div>

      ${
        highlight.note
          ? `
        <div class="highlight-note-label">Note</div>
        <div class="highlight-note">${escapeHtml(highlight.note)}</div>
      `
          : ""
      }

      <div class="highlight-meta">
        <span class="highlight-date">${formattedDate}</span>
        <a href="${highlight.url}" class="highlight-url" title="${highlight.url}">
          ${displayUrl}
        </a>
      </div>
    `;

    // Add event listeners
    const menuBtn = card.querySelector(".menu-btn");
    const dropdown = card.querySelector(".card-dropdown");
    const favoriteBtn = card.querySelector(".favorite-btn");
    const editBtn = card.querySelector(".edit-btn");
    const deleteBtn = card.querySelector(".delete-btn");
    const pageTitle = card.querySelector(".page-title");
    const urlLink = card.querySelector(".highlight-url");

    // Toggle dropdown menu
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close any other open dropdowns
      document.querySelectorAll('.card-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.add('hidden');
      });
      dropdown.classList.toggle('hidden');
    });

    favoriteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.add('hidden');
      toggleFavorite(highlight.id);
    });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.add('hidden');
      handleEdit(highlight);
    });
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.add('hidden');
      handleDelete(highlight);
    });

    pageTitle.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToHighlight(highlight);
    });

    urlLink.addEventListener("click", (e) => {
      e.preventDefault();
      navigateToHighlight(highlight);
    });

    return card;
  }

  // Get color class from color value
  function getColorClass(color) {
    const colorMap = {
      "#ffeb3b": "color-yellow",
      "#a5d6a7": "color-green",
      "#90caf9": "color-blue",
      "#ff9eb5": "color-pink",
    };
    return colorMap[color] || "color-yellow";
  }

  // Format date
  function formatDate(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;

    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Handle search input
  // Handle edit note
  function handleEdit(highlight) {
    const card = document.querySelector(
      `[data-highlight-id="${highlight.id}"]`,
    );
    if (!card) return;

    // Create edit interface
    const noteSection =
      card.querySelector(".highlight-note") || document.createElement("div");
    const noteLabel = card.querySelector(".highlight-note-label");
    const currentNote = highlight.note || "";

    const editHtml = `
      <div class="edit-note-container">
        <textarea class="edit-note-textarea" placeholder="Add your note here...">${escapeHtml(currentNote)}</textarea>
        <div class="edit-actions">
          <button class="save-btn">Save</button>
          <button class="cancel-btn">Cancel</button>
        </div>
      </div>
    `;

    // Replace note section with edit interface
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = editHtml;
    const editContainer = tempDiv.firstElementChild;

    if (noteLabel) noteLabel.style.display = "none";
    if (noteSection.classList.contains("highlight-note")) {
      noteSection.replaceWith(editContainer);
    } else {
      const textDiv = card.querySelector(".highlight-text");
      textDiv.after(editContainer);
    }

    const textarea = editContainer.querySelector(".edit-note-textarea");
    const saveBtn = editContainer.querySelector(".save-btn");
    const cancelBtn = editContainer.querySelector(".cancel-btn");

    textarea.focus();

    saveBtn.addEventListener("click", () => {
      const newNote = textarea.value.trim();
      updateNote(highlight.id, newNote);
    });

    cancelBtn.addEventListener("click", () => {
      loadHighlights(); // Reload to cancel edit
    });
  }

  // Update note in storage
  function updateNote(highlightId, note) {
    chrome.storage.local.get(["highlights"], function (result) {
      const highlights = result.highlights || [];
      const highlight = highlights.find((h) => h.id === highlightId);

      if (highlight) {
        highlight.note = note;
        highlight.lastModified = new Date().toISOString();

        chrome.storage.local.set({ highlights: highlights }, function () {
          loadHighlights(); // Reload to show updated note
        });
      }
    });
  }

  // Handle delete
  function handleDelete(highlight) {
    if (
      !confirm(
        `Delete this highlight?\n\n"${highlight.text.substring(0, 100)}..."`,
      )
    ) {
      return;
    }

    chrome.storage.local.get(["highlights"], function (result) {
      const highlights = result.highlights || [];
      const filtered = highlights.filter((h) => h.id !== highlight.id);

      chrome.storage.local.set({ highlights: filtered }, function () {
        loadHighlights(); // Reload after deletion
      });
    });
  }

  // Navigate to highlight on page
  function navigateToHighlight(highlight) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.create({ url: highlight.url });
    });
  }

  // Handle clear all
  function handleClearAll() {
    if (
      !confirm(
        `Delete ALL ${allHighlights.length} highlights? This cannot be undone.`,
      )
    ) {
      return;
    }

    chrome.storage.local.set({ highlights: [] }, function () {
      loadHighlights();
    });
  }

  // Handle export
  function handleExport() {
    if (allHighlights.length === 0) {
      alert("No highlights to export.");
      return;
    }

    // Create export data
    const exportData = {
      exportDate: new Date().toISOString(),
      highlightCount: allHighlights.length,
      highlights: allHighlights,
    };

    // Create markdown format
    let markdown = `# SenseNote Export\n\n`;
    markdown += `Exported: ${new Date().toLocaleString()}\n`;
    markdown += `Total Highlights: ${allHighlights.length}\n\n`;
    markdown += `---\n\n`;

    allHighlights.forEach((highlight, index) => {
      markdown += `## ${index + 1}. ${highlight.pageTitle}\n\n`;
      markdown += `**Highlighted Text:**\n> ${highlight.text}\n\n`;
      if (highlight.note) {
        markdown += `**Note:**\n${highlight.note}\n\n`;
      }
      markdown += `**Source:** [${highlight.url}](${highlight.url})\n`;
      markdown += `**Date:** ${new Date(highlight.timestamp).toLocaleString()}\n\n`;
      markdown += `---\n\n`;
    });

    // Download as file
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sensenote-export-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Toggle favorite status
  function toggleFavorite(highlightId) {
    chrome.storage.local.get(["highlights"], function (result) {
      const highlights = result.highlights || [];
      const highlight = highlights.find((h) => h.id === highlightId);

      if (highlight) {
        highlight.favorite = !highlight.favorite;

        chrome.storage.local.set({ highlights: highlights }, function () {
          loadHighlights(); // Reload to show updated favorite status
        });
      }
    });
  }

  // Handle search (placeholder)
  function handleSearch() {
    alert("Search functionality coming soon!");
  }

  // Handle filter
  function handleFilter() {
    // Get all unique categories from highlights
    const categories = [...new Set(allHighlights.map(h => h.category).filter(c => c && c.trim()))].sort();
    
    // Build category options HTML
    const categoryOptionsHtml = categories.length > 0 
      ? categories.map(cat => `
          <label class="category-filter-option">
            <input type="radio" name="category-filter" value="${escapeHtml(cat)}" ${currentFilters.category === cat ? 'checked' : ''}>
            <span>${escapeHtml(cat)}</span>
          </label>
        `).join('')
      : '<p class="no-categories">No categories yet</p>';

    // Create filter modal
    const modal = document.createElement('div');
    modal.className = 'filter-modal';
    modal.innerHTML = `
      <div class="filter-content">
        <div class="filter-header">
          <h3>Filter Highlights</h3>
          <button class="close-modal-btn" title="Close">×</button>
        </div>
        
        <div class="filter-section">
          <label class="filter-label">
            <input type="checkbox" id="filter-favorite" ${currentFilters.favoriteOnly ? 'checked' : ''}>
            <span>Show favorites only</span>
          </label>
        </div>

        <div class="filter-section">
          <h4>Filter by Category</h4>
          <div class="category-filters">
            <label class="category-filter-option">
              <input type="radio" name="category-filter" value="all" ${currentFilters.category === 'all' ? 'checked' : ''}>
              <span>All Categories</span>
            </label>
            ${categoryOptionsHtml}
          </div>
        </div>

        <div class="filter-section">
          <h4>Filter by Color</h4>
          <div class="color-filters">
            <label class="color-filter-option">
              <input type="radio" name="color-filter" value="all" ${currentFilters.color === 'all' ? 'checked' : ''}>
              <span>All Colors</span>
            </label>
            <label class="color-filter-option">
              <input type="radio" name="color-filter" value="#ffeb3b" ${currentFilters.color === '#ffeb3b' ? 'checked' : ''}>
              <span class="color-swatch" style="background: #ffeb3b;"></span>
              <span>Yellow</span>
            </label>
            <label class="color-filter-option">
              <input type="radio" name="color-filter" value="#90caf9" ${currentFilters.color === '#90caf9' ? 'checked' : ''}>
              <span class="color-swatch" style="background: #90caf9;"></span>
              <span>Blue</span>
            </label>
            <label class="color-filter-option">
              <input type="radio" name="color-filter" value="#ff9eb5" ${currentFilters.color === '#ff9eb5' ? 'checked' : ''}>
              <span class="color-swatch" style="background: #ff9eb5;"></span>
              <span>Pink</span>
            </label>
            <label class="color-filter-option">
              <input type="radio" name="color-filter" value="#a5d6a7" ${currentFilters.color === '#a5d6a7' ? 'checked' : ''}>
              <span class="color-swatch" style="background: #a5d6a7;"></span>
              <span>Green</span>
            </label>
          </div>
        </div>

        <div class="filter-section">
          <h4>Sort by Date</h4>
          <div class="date-filters">
            <label class="date-filter-option">
              <input type="radio" name="date-sort" value="newest" ${currentFilters.dateSort === 'newest' ? 'checked' : ''}>
              <span>Newest First</span>
            </label>
            <label class="date-filter-option">
              <input type="radio" name="date-sort" value="oldest" ${currentFilters.dateSort === 'oldest' ? 'checked' : ''}>
              <span>Oldest First</span>
            </label>
          </div>
        </div>

        <div class="filter-actions">
          <button class="reset-filters-btn">Reset Filters</button>
          <button class="apply-filters-btn">Apply</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event listeners for filter modal
    const closeBtn = modal.querySelector('.close-modal-btn');
    const applyBtn = modal.querySelector('.apply-filters-btn');
    const resetBtn = modal.querySelector('.reset-filters-btn');
    const favoriteCheckbox = modal.querySelector('#filter-favorite');

    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    applyBtn.addEventListener('click', () => {
      currentFilters.favoriteOnly = favoriteCheckbox.checked;
      currentFilters.category = modal.querySelector('input[name="category-filter"]:checked').value;
      currentFilters.color = modal.querySelector('input[name="color-filter"]:checked').value;
      currentFilters.dateSort = modal.querySelector('input[name="date-sort"]:checked').value;
      renderHighlights();
      modal.remove();
    });

    resetBtn.addEventListener('click', () => {
      currentFilters = {
        favoriteOnly: false,
        color: 'all',
        category: 'all',
        dateSort: 'newest'
      };
      renderHighlights();
      modal.remove();
    });
  }

  // Handle settings (placeholder)
  function handleSettings() {
    alert(
      "Settings coming soon!\n\nPlanned features:\n• Custom highlight colors\n• Keyboard shortcuts\n• Auto-sync options\n• Export formats",
    );
  }

  // Initialize popup
  init();
})();
