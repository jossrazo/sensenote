// SenseNote (formerly Mark2Link) - Content Script
// Handles text highlighting and annotation on web pages

(function() {
  'use strict';

  let highlights = [];
  let selectedHighlight = null;
  let justClosedMenu = false;

  // Load existing highlights for this page
  function loadHighlights() {
    // Strip hash from URL for comparison (to support navigation with hash)
    const pageUrl = window.location.href.split('#')[0];
    chrome.storage.local.get(['highlights'], function(result) {
      const allHighlights = result.highlights || [];
      highlights = allHighlights.filter(h => h.url.split('#')[0] === pageUrl);
      console.log(`SenseNote: Found ${highlights.length} highlight(s) for this page`);
      
      // Wait for page to be fully loaded before restoring
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreHighlights);
      } else {
        restoreHighlights();
      }
    });
  }

  // Restore highlights on page load
  function restoreHighlights() {
    console.log('SenseNote: Restoring highlights...');
    let successCount = 0;
    let failCount = 0;
    
    highlights.forEach(highlight => {
      try {
        const range = createRangeFromHighlight(highlight);
        if (range) {
          applyHighlight(range, highlight.id, highlight.color);
          successCount++;
        } else {
          console.warn('SenseNote: Could not create range for highlight:', highlight.text.substring(0, 50));
          failCount++;
        }
      } catch (e) {
        console.error('SenseNote: Error restoring highlight:', e, highlight.text.substring(0, 50));
        failCount++;
      }
    });
    
    console.log(`SenseNote: Restored ${successCount} highlight(s), ${failCount} failed`);
    
    if (successCount > 0) {
      showToast(`✓ Restored ${successCount} highlight(s)`);
    }
  }

  // Create a range object from saved highlight data
  function createRangeFromHighlight(highlight) {
    // Skip if already highlighted
    const existingHighlight = document.querySelector(`[data-highlight-id="${highlight.id}"]`);
    if (existingHighlight) {
      console.log('SenseNote: Highlight already exists on page:', highlight.id);
      return null;
    }

    // Use context-based matching for accuracy
    return findTextWithContext(highlight.text, highlight.textBefore, highlight.textAfter);
  }

  // Find text with context matching (most reliable method)
  function findTextWithContext(searchText, textBefore = '', textAfter = '') {
    if (!searchText || searchText.length === 0) {
      return null;
    }

    // Collect all text nodes first
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (!node.textContent.trim() || 
              (node.parentElement && node.parentElement.classList.contains('mark2link-highlight'))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    const textNodes = [];
    let node;
    let fullText = '';
    
    while (node = walker.nextNode()) {
      const startOffset = fullText.length;
      const nodeText = node.textContent;
      textNodes.push({
        node: node,
        startOffset: startOffset,
        endOffset: startOffset + nodeText.length,
        text: nodeText
      });
      fullText += nodeText;
    }

    // Build the context pattern to search for
    const contextPattern = (textBefore || '') + searchText + (textAfter || '');
    
    // Find the pattern in full text
    let searchIndex = -1;
    
    // Try with context first
    if (textBefore || textAfter) {
      const patternIndex = fullText.indexOf(contextPattern);
      if (patternIndex !== -1) {
        searchIndex = patternIndex + (textBefore || '').length;
        console.log('SenseNote: Found exact match with context');
      }
    }
    
    // Fallback: search for just the text
    if (searchIndex === -1) {
      searchIndex = fullText.indexOf(searchText);
      if (searchIndex === -1) {
        console.warn('SenseNote: Text not found on page:', searchText.substring(0, 50));
        return null;
      }
      console.log('SenseNote: Found text without context');
    }

    // Find the nodes that contain our target text
    const targetStart = searchIndex;
    const targetEnd = searchIndex + searchText.length;
    
    let startNode = null, startNodeOffset = 0;
    let endNode = null, endNodeOffset = 0;

    for (const nodeInfo of textNodes) {
      // Check if this node contains the start position
      if (targetStart >= nodeInfo.startOffset && targetStart < nodeInfo.endOffset && !startNode) {
        startNode = nodeInfo.node;
        startNodeOffset = targetStart - nodeInfo.startOffset;
      }
      
      // Check if this node contains the end position
      if (targetEnd > nodeInfo.startOffset && targetEnd <= nodeInfo.endOffset && !endNode) {
        endNode = nodeInfo.node;
        endNodeOffset = targetEnd - nodeInfo.startOffset;
      }
      
      if (startNode && endNode) break;
    }

    // Create the range
    if (startNode && endNode) {
      try {
        const range = document.createRange();
        range.setStart(startNode, startNodeOffset);
        range.setEnd(endNode, endNodeOffset);
        
        // Final verification
        const rangeText = range.toString();
        if (rangeText === searchText) {
          console.log('SenseNote: Successfully restored highlight');
          return range;
        } else {
          console.warn('SenseNote: Range text mismatch. Expected:', searchText.substring(0, 30), 'Got:', rangeText.substring(0, 30));
        }
      } catch (e) {
        console.error('SenseNote: Error creating range:', e);
      }
    } else {
        console.warn('SenseNote: Could not find text nodes for range');
    }

    return null;
  }

  // Apply visual highlight to a range
  function applyHighlight(range, highlightId, color = '#ffeb3b') {
    try {
      // Validate range
      if (!range || range.collapsed) {
        console.warn('SenseNote: Invalid or collapsed range');
        return;
      }

      // Clone range to preserve original
      const workingRange = range.cloneRange();

      // Try simple surroundContents first (works ~80% of the time)
      const span = document.createElement('span');
      span.className = 'mark2link-highlight';
      span.setAttribute('data-highlight-id', highlightId);
      span.style.backgroundColor = color;
      span.style.cursor = 'pointer';
      
      try {
        workingRange.surroundContents(span);
        span.addEventListener('click', function(e) {
          e.stopPropagation();
          showHighlightMenu(highlightId, e.pageX, e.pageY);
        });
        return;
      } catch (e) {
        // surroundContents failed - selection crosses elements
        // Use fallback method
      }

      // Fallback: Extract and wrap content manually
      const contents = workingRange.extractContents();
      const wrapper = document.createElement('span');
      wrapper.className = 'mark2link-highlight';
      wrapper.setAttribute('data-highlight-id', highlightId);
      wrapper.style.backgroundColor = color;
      wrapper.style.cursor = 'pointer';
      
      wrapper.appendChild(contents);
      workingRange.insertNode(wrapper);
      
      wrapper.addEventListener('click', function(e) {
        e.stopPropagation();
        showHighlightMenu(highlightId, e.pageX, e.pageY);
      });

      // Normalize to merge adjacent text nodes
      if (wrapper.parentNode) {
        wrapper.parentNode.normalize();
      }

    } catch (e) {
      console.error('SenseNote: Error applying highlight:', e);
      // Last resort: just log and continue
      showToast('⚠️ Could not highlight this selection');
    }
  }

  // Handle text selection
  document.addEventListener('mouseup', function(e) {
    // Skip if selection is in input fields or editable elements
    const isInputField = e.target.matches('input, textarea, [contenteditable="true"]') || 
                         e.target.closest('input, textarea, [contenteditable="true"]');
    
    if (isInputField) {
      return;
    }

    // Check if click is on a button inside menu/dialog
    const isButton = e.target.closest('.mark2link-menu button, .mark2link-dialog button');
    
    // Skip processing if we just closed a menu via button click
    if (justClosedMenu && isButton) {
      return;
    }

    // Don't close menus if clicking on a menu, dialog, popup, or highlight
    const isMenuClick = e.target.closest('.mark2link-menu');
    const isDialogClick = e.target.closest('.mark2link-dialog');
    const isPopupClick = e.target.closest('.mark2link-note-popup');
    const isHighlightClick = e.target.closest('.mark2link-highlight');
    
    if (!isMenuClick && !isDialogClick && !isPopupClick && !isHighlightClick) {
      // Close menus WITHOUT cooldown when clicking away (not a button)
      closeAllMenus(true);
    }

    // Use setTimeout to ensure selection is finalized
    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      // Validate selection
      if (selectedText.length > 0 && 
          !isMenuClick && 
          !isDialogClick && 
          !isPopupClick &&
          !isHighlightClick &&
          selection.rangeCount > 0) {
        
        try {
          const range = selection.getRangeAt(0);
          
          // Ensure range is valid and not collapsed
          if (!range.collapsed) {
            showSelectionMenu(range, e.pageX, e.pageY);
          }
        } catch (err) {
          console.warn('SenseNote: Could not get selection range:', err);
        }
      }
    }, 10);
  });

  // Show menu after text selection
  function showSelectionMenu(range, x, y) {
    // Clone the range to preserve it
    const clonedRange = range.cloneRange();
    const selectedText = range.toString().trim();
    
    const menu = createMenu([
      { label: '', color: '#ffeb3b', action: () => createHighlightFromText(clonedRange, selectedText, '#ffeb3b') },
      { label: '', color: '#90caf9', action: () => createHighlightFromText(clonedRange, selectedText, '#90caf9') },
      { label: '', color: '#ff9eb5', action: () => createHighlightFromText(clonedRange, selectedText, '#ff9eb5') },
      { label: '', color: '#a5d6a7', action: () => createHighlightFromText(clonedRange, selectedText, '#a5d6a7') }
    ], x, y);
  }

  // Show menu for existing highlight
  function showHighlightMenu(highlightId, x, y) {
    // Reload highlights from storage to ensure we have latest data
    chrome.storage.local.get(['highlights'], function(result) {
      const allHighlights = result.highlights || [];
      const pageUrl = window.location.href;
      highlights = allHighlights.filter(h => h.url === pageUrl);
      
      const highlight = highlights.find(h => h.id === highlightId);
      if (!highlight) {
        console.error('Highlight not found:', highlightId);
        return;
      }

      // Show note popup directly
      showNotePopup(highlightId, x, y);
    });
  }

  // Show note popup (compact view mode)
  function showNotePopup(highlightId, x, y) {
    const highlight = highlights.find(h => h.id === highlightId);
    if (!highlight) {
      console.error('Highlight not found for note popup:', highlightId);
      return;
    }

    closeAllMenus();

    const popup = document.createElement('div');
    popup.className = 'mark2link-note-popup';
    popup.style.position = 'absolute';
    popup.style.left = x + 'px';
    popup.style.top = (y + 10) + 'px';
    popup.style.zIndex = '999999';
    
    const hasNote = highlight.note && highlight.note.trim().length > 0;

    const editIconUrl = chrome.runtime.getURL('icons/edit.svg');
    const deleteIconUrl = chrome.runtime.getURL('icons/trash-2.svg');
    const truncatedText = highlight.text.length > 50 
      ? highlight.text.substring(0, 50) + '...' 
      : highlight.text;
    
    popup.innerHTML = `
      <div class="mark2link-note-popup-text">"${escapeHtml(truncatedText)}"</div>
      ${hasNote 
        ? `<div class="mark2link-note-popup-content">${escapeHtml(highlight.note)}</div>` 
        : `<div class="mark2link-note-popup-empty">No note</div>`
      }
      <div class="mark2link-note-popup-buttons">
        <button class="mark2link-popup-btn" id="edit-note-btn" title="Edit Note">
          <img src="${editIconUrl}" alt="Edit Note" class="mark2link-popup-btn-icon">
        </button>
        <button class="mark2link-popup-btn" id="delete-highlight-btn" title="Delete">
          <img src="${deleteIconUrl}" alt="Delete Highlight" class="mark2link-popup-btn-icon">
        </button>
      </div>
    `;

    document.body.appendChild(popup);
    
    // Stop clicks inside popup from propagating
    popup.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    popup.querySelector('#edit-note-btn').onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      closeAllMenus();
      showNoteDialog(highlightId);
    };

    popup.querySelector('#delete-highlight-btn').onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      closeAllMenus();
      deleteHighlight(highlightId);
    };

    // Close popup when clicking outside
    setTimeout(() => {
      document.addEventListener('click', function closePopupHandler(e) {
        if (!e.target.closest('.mark2link-note-popup')) {
          closeAllMenus();
        }
      }, { once: true });
    }, 200);
  }

  // Create a context menu
  function createMenu(items, x, y) {
    closeAllMenus();

    const menu = document.createElement('div');
    menu.className = 'mark2link-menu';
    menu.style.position = 'absolute';
    menu.style.left = x + 'px';
    menu.style.top = (y + 10) + 'px';
    menu.style.zIndex = '999999';

    items.forEach(item => {
      const button = document.createElement('button');
      button.className = 'mark2link-menu-item';
      button.textContent = item.label;
      if (item.color) {
        button.style.backgroundColor = item.color;
        button.setAttribute('data-color', item.color);
      }
      button.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        item.action();
        closeAllMenus();
      };
      menu.appendChild(button);
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside (with a small delay to allow menu clicks)
    setTimeout(() => {
      document.addEventListener('click', function closeMenuHandler(e) {
        if (!e.target.closest('.mark2link-menu')) {
          closeAllMenus();
        }
      }, { once: true });
    }, 200);

    return menu;
  }

  // Close all open menus (with optional flag to skip cooldown)
  function closeAllMenus(skipCooldown = false) {
    const elements = document.querySelectorAll('.mark2link-menu, .mark2link-dialog, .mark2link-note-popup');
    if (elements.length > 0 && !skipCooldown) {
      justClosedMenu = true;
      // Reset flag on next animation frame (fastest safe reset)
      requestAnimationFrame(() => {
        justClosedMenu = false;
      });
    }
    elements.forEach(el => el.remove());
  }

  // Create a new highlight from preserved text and range
  function createHighlightFromText(range, text, color) {
    if (!text || text.length === 0) {
      console.warn('SenseNote: No text to highlight');
      return;
    }

    try {
      // Capture surrounding context for better restoration (30 chars before and after)
      let textBefore = '';
      let textAfter = '';
      let startOffset = 0;
      let endOffset = 0;
      
      try {
        // Build full text from text nodes (SAME method used in restoration)
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function(node) {
              if (!node.textContent.trim()) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          },
          false
        );
        
        const textNodes = [];
        let fullText = '';
        let node;
        
        while (node = walker.nextNode()) {
          textNodes.push({
            node: node,
            startOffset: fullText.length,
            endOffset: fullText.length + node.textContent.length
          });
          fullText += node.textContent;
        }
        
        // Find where our range starts in the fullText
        // by locating the startContainer in our textNodes list
        for (const nodeInfo of textNodes) {
          if (nodeInfo.node === range.startContainer) {
            startOffset = nodeInfo.startOffset + range.startOffset;
            endOffset = startOffset + text.length;
            break;
          }
        }
        
        // Extract context using the calculated offset
        const contextLength = 50; // Increased from 30 for better accuracy
        textBefore = fullText.substring(Math.max(0, startOffset - contextLength), startOffset);
        textAfter = fullText.substring(endOffset, Math.min(fullText.length, endOffset + contextLength));
        
        console.log('SenseNote: Captured context - offset:', startOffset, 'before:', textBefore.length, 'chars, after:', textAfter.length, 'chars');
      } catch (e) {
        // Context extraction failed, continue without it
        console.warn('SenseNote: Could not extract context:', e);
      }

      const highlightId = 'hl-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      
      const highlightData = {
        id: highlightId,
        text: text,
        textBefore: textBefore,  // Context for better matching
        textAfter: textAfter,    // Context for better matching
        url: window.location.href.split('#')[0], // Strip hash to ensure consistency
        pageTitle: document.title,
        startOffset: startOffset,
        endOffset: endOffset,
        color: color,
        note: '',
        category: '',
        timestamp: new Date().toISOString()
      };

      // Save to storage
      chrome.storage.local.get(['highlights'], function(result) {
        const allHighlights = result.highlights || [];
        allHighlights.push(highlightData);
        chrome.storage.local.set({ highlights: allHighlights }, function() {
          highlights.push(highlightData);
          
          // Apply highlight with fresh range
          applyHighlight(range, highlightId, color);
          
          // Clear selection
          try {
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
            }
          } catch (e) {
            // Ignore selection clearing errors
          }
          
          // Show success message
          showToast('✓ Highlight saved!');
          
          // Prompt for note
          setTimeout(() => showNoteDialog(highlightId), 500);
        });
      });
    } catch (e) {
      console.error('SenseNote: Error creating highlight:', e);
      showToast('⚠️ Could not save highlight');
    }
  }

  // Create a new highlight (legacy wrapper)
  function createHighlight(range, color) {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    createHighlightFromText(range, selectedText, color);
  }

  // Show note dialog
  function showNoteDialog(highlightId) {
    const highlight = highlights.find(h => h.id === highlightId);
    if (!highlight) {
      console.error('Highlight not found for note dialog:', highlightId);
      return;
    }

    closeAllMenus();

    // Get existing categories for suggestions
    chrome.storage.local.get(['highlights'], function(result) {
      const allHighlights = result.highlights || [];
      const existingCategories = [...new Set(allHighlights.map(h => h.category).filter(c => c && c.trim()))];
      
      const dialog = document.createElement('div');
      dialog.className = 'mark2link-dialog';
      
      // Prevent dialog clicks from propagating
      dialog.addEventListener('click', function(e) {
        // Only close if clicking the backdrop (not the content)
        if (e.target === dialog) {
          closeAllMenus();
        }
      });
      
      dialog.innerHTML = `
        <div class="mark2link-dialog-content">
          <h3>Edit Highlight</h3>
          <div class="mark2link-highlight-text">"${escapeHtml(highlight.text.substring(0, 100))}${highlight.text.length > 100 ? '...' : ''}"</div>
          
          <div class="mark2link-field">
            <label class="mark2link-label">Category</label>
            <div class="mark2link-category-input-wrapper">
              <input type="text" class="mark2link-category-input" id="category-input" placeholder="Add category..." value="${escapeHtml(highlight.category || '')}" list="category-suggestions">
              <datalist id="category-suggestions">
                ${existingCategories.map(c => `<option value="${escapeHtml(c)}">`).join('')}
              </datalist>
            </div>
            ${existingCategories.length > 0 ? `
              <div class="mark2link-category-suggestions">
                ${existingCategories.slice(0, 5).map(c => `<button class="mark2link-category-tag" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
              </div>
            ` : ''}
          </div>
          
          <div class="mark2link-field">
            <label class="mark2link-label">Note</label>
            <textarea class="mark2link-note-input" placeholder="Add your note here...">${escapeHtml(highlight.note || '')}</textarea>
          </div>
          
          <div class="mark2link-dialog-buttons">
            <button class="mark2link-btn mark2link-btn-primary" id="save-note">Save</button>
            <button class="mark2link-btn mark2link-btn-secondary" id="cancel-note">Cancel</button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      const dialogContent = dialog.querySelector('.mark2link-dialog-content');
      const textarea = dialog.querySelector('.mark2link-note-input');
      const categoryInput = dialog.querySelector('#category-input');
      const categoryTags = dialog.querySelectorAll('.mark2link-category-tag');
      
      // Stop clicks inside dialog content from closing it
      dialogContent.addEventListener('click', function(e) {
        e.stopPropagation();
      });
      
      // Category tag click handlers
      categoryTags.forEach(tag => {
        tag.addEventListener('click', function(e) {
          e.preventDefault();
          categoryInput.value = this.dataset.category;
        });
      });
      
      categoryInput.focus();

      dialog.querySelector('#save-note').onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        const note = textarea.value.trim();
        const category = categoryInput.value.trim();
        saveHighlightDetails(highlightId, note, category);
        closeAllMenus();
      };

      dialog.querySelector('#cancel-note').onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
      };
    });
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Save note to highlight (legacy wrapper)
  function saveNote(highlightId, note) {
    saveHighlightDetails(highlightId, note, null);
  }

  // Save highlight details (note and category)
  function saveHighlightDetails(highlightId, note, category) {
    chrome.storage.local.get(['highlights'], function(result) {
      const allHighlights = result.highlights || [];
      const highlight = allHighlights.find(h => h.id === highlightId);
      
      if (highlight) {
        if (note !== null) highlight.note = note;
        if (category !== null) highlight.category = category;
        highlight.lastModified = new Date().toISOString();
        
        chrome.storage.local.set({ highlights: allHighlights }, function() {
          const localHighlight = highlights.find(h => h.id === highlightId);
          if (localHighlight) {
            if (note !== null) localHighlight.note = note;
            if (category !== null) localHighlight.category = category;
          }
          showToast('✓ Saved!');
        });
      }
    });
  }

  // Show highlight info
  function showHighlightInfo(highlightId) {
    const highlight = highlights.find(h => h.id === highlightId);
    if (!highlight) {
      console.error('Highlight not found for info dialog:', highlightId);
      return;
    }

    closeAllMenus();

    const dialog = document.createElement('div');
    dialog.className = 'mark2link-dialog';
    
    // Prevent dialog clicks from propagating
    dialog.addEventListener('click', function(e) {
      // Only close if clicking the backdrop (not the content)
      if (e.target === dialog) {
        closeAllMenus();
      }
    });
    
    const date = new Date(highlight.timestamp).toLocaleString();
    
    dialog.innerHTML = `
      <div class="mark2link-dialog-content">
        <h3>Highlight Info</h3>
        <div class="mark2link-info">
          <p><strong>Text:</strong> "${escapeHtml(highlight.text)}"</p>
          ${highlight.note ? `<p><strong>Note:</strong> ${escapeHtml(highlight.note)}</p>` : ''}
          <p><strong>Created:</strong> ${date}</p>
          <p><strong>Page:</strong> ${escapeHtml(highlight.pageTitle)}</p>
        </div>
        <div class="mark2link-dialog-buttons">
          <button class="mark2link-btn mark2link-btn-primary" id="close-info">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const dialogContent = dialog.querySelector('.mark2link-dialog-content');
    
    // Stop clicks inside dialog content from closing it
    dialogContent.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    dialog.querySelector('#close-info').onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      closeAllMenus();
    };
  }

  // Delete highlight
  function deleteHighlight(highlightId) {
    if (!confirm('Delete this highlight?')) return;

    chrome.storage.local.get(['highlights'], function(result) {
      const allHighlights = result.highlights || [];
      const filtered = allHighlights.filter(h => h.id !== highlightId);
      
      chrome.storage.local.set({ highlights: filtered }, function() {
        // Remove from local array
        highlights = highlights.filter(h => h.id !== highlightId);
        
        // Remove visual highlight
        const element = document.querySelector(`[data-highlight-id="${highlightId}"]`);
        if (element) {
          const parent = element.parentNode;
          while (element.firstChild) {
            parent.insertBefore(element.firstChild, element);
          }
          parent.removeChild(element);
          parent.normalize();
        }
        
        showToast('✓ Highlight deleted');
      });
    });
  }

  // Show toast notification
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'mark2link-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 100);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // Scroll to highlight if URL contains hash
  function scrollToHighlightFromHash() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#sensenote-')) {
      const highlightId = hash.replace('#sensenote-', '');
      
      let attempts = 0;
      const maxAttempts = 10;
      
      const tryScroll = () => {
        attempts++;
        const highlightElement = document.querySelector(`[data-highlight-id="${highlightId}"]`);
        
        if (highlightElement) {
          console.log('SenseNote: Found highlight, scrolling to it');
          highlightElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
          
          // Clean up hash from URL after a short delay
          setTimeout(() => {
            history.replaceState(null, null, window.location.pathname + window.location.search);
          }, 1000);
        } else if (attempts < maxAttempts) {
          console.log(`SenseNote: Highlight not found yet, retrying... (${attempts}/${maxAttempts})`);
          setTimeout(tryScroll, 500); // Retry every 500ms
        } else {
          console.warn('SenseNote: Could not find highlight after', maxAttempts, 'attempts');
          // Clean up hash anyway
          history.replaceState(null, null, window.location.pathname + window.location.search);
        }
      };
      
      // Start trying after a short delay
      setTimeout(tryScroll, 500);
    }
  }

  // Initialize
  console.log('SenseNote: Content script loaded successfully');
  loadHighlights();
  
  // Check for highlight hash after page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scrollToHighlightFromHash);
  } else {
    scrollToHighlightFromHash();
  }

  // Listen for hash changes (when navigating within the same page)
  window.addEventListener('hashchange', scrollToHighlightFromHash);

})();

