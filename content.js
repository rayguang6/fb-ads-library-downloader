// Function to extract data from an ad container
function extractAdData(adContainer) {
  const adData = {
    libraryId: null,
    startedRunningOn: null,
    advertiserProfileImage: null,
    advertiserProfileLink: null,
    advertiserName: null,
    adText: null,
    mediaUrls: [],
    adLink:null,
    timestamp: new Date().toISOString()
  };

  try {
    // Get Library ID - looking for spans containing "Library ID:"
    const allSpans = adContainer.querySelectorAll('span.x8t9es0');

    // 1. Extract Library ID
    for (const span of allSpans) {
      if (span.textContent.includes('Library ID:')) {
        const match = span.textContent.match(/Library ID:\s*(\d+)/);
        if (match && match[1]) {
          adData.libraryId = match[1];
        }
        break;
      }
    }

    // 2. Extract "Started running on" info (only the date part)
    for (const span of allSpans) {
      if (span.textContent.includes('Started running on')) {
        // Regex to capture only the date portion before any "·" separator.
        const match = span.textContent.match(/Started running on\s+([^·]+)/);
        if (match && match[1]) {
          adData.startedRunningOn = match[1].trim();
        }
        break;
      }
    }

    // 3. Get Advertiser Profile Link and Name
    const advertiserEl = adContainer.querySelector('a.xt0psk2');
    if (advertiserEl) {
      adData.advertiserProfileLink = advertiserEl.href || null;
      adData.advertiserName = advertiserEl.textContent.trim();
    }

    // 4. Get Advertiser Profile Image
    // First, try finding an image inside the advertiser link
    let profileImgEl = adContainer.querySelector('a.xt0psk2 img');
    // If not found, try a fallback selector (e.g., image with class "_8nqq")
    if (!profileImgEl) {
      profileImgEl = adContainer.querySelector('img._8nqq');
    }
    if (profileImgEl && profileImgEl.src) {
      adData.advertiserProfileImage = profileImgEl.src;
    }

    // NEW: Get the ad link by looking for a specific anchor
    const adLinkEl = adContainer.querySelector('a[href*="l.facebook.com/l.php?u="]');
    if (adLinkEl) {
      adData.adLink = adLinkEl.href;
    }

    // 5. Get Ad Text (existing logic)
    const adTextEl = adContainer.querySelector('div._7jyr span');
    if (adTextEl && adTextEl.textContent) {
      adData.adText = adTextEl.textContent.trim();
    }

    // First priority: Get video if available
    const videoEl = adContainer.querySelector('video');
    if (videoEl && videoEl.src) {
      adData.mediaUrls.push({
        type: 'video',
        url: videoEl.src
      });
    } 
    // If no video, look for the main ad image
    else {
      // Look for the main ad image in the video display area
      const mainImage = adContainer.querySelector('.x1ywc1zp img, .x14ju556 img');
      if (mainImage && mainImage.src && !mainImage.src.includes('s60x60')) {
        adData.mediaUrls.push({
          type: 'image',
          url: mainImage.src
        });
      }
      // Try to find image in the main content container
      else {
        // Based on the HTML structure, look for the large images (avoiding profile pics)
        const contentImages = adContainer.querySelectorAll('.x1lliihq.x5yr21d.xh8yej3');
        for (const img of contentImages) {
          if (img.src && !img.src.includes('s60x60')) {
            adData.mediaUrls.push({
              type: 'image',
              url: img.src
            });
            break;
          }
        }
      }
      
      // If still no images found, try the more general approach with filtering
      if (adData.mediaUrls.length === 0) {
        const allImages = adContainer.querySelectorAll('img');
        // Sort by width to prioritize larger images
        const sortedImages = Array.from(allImages).sort((a, b) => {
          const widthA = a.width || a.clientWidth || 0;
          const widthB = b.width || b.clientWidth || 0;
          return widthB - widthA; // Descending order
        });
        
        for (const img of sortedImages) {
          // Skip profile pictures and tiny images
          const width = img.width || img.clientWidth || 0;
          if (img.src && width > 150 && !img.src.includes('s60x60') && !img.src.includes('profile_pic')) {
            adData.mediaUrls.push({
              type: 'image',
              url: img.src
            });
            break;
          }
        }
      }
    }



    // Add debugging data for verification
    adData.debug = {
      containerHTML: adContainer.outerHTML.substring(0, 500) + '...' // First 500 chars for debugging
    };

  } catch (e) {
    console.error('Error extracting ad data:', e);
    adData.error = e.message;
  }

  return adData;
}

// Function to download JSON data
function downloadJSON(data, filename = 'fb_ad_data.json') {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  
  // Trigger download
  link.click();
  
  // Clean up
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Function to add button to an ad container
function addButtonToContainer(container) {
  // Skip if already has our button
  if (container.querySelector('.fb-ad-button')) {
    return;
  }
  
  // Create button
  const button = document.createElement('button');
  button.textContent = 'Download JSON';
  button.className = 'fb-ad-button';
  button.style.cssText = `
    background-color: #1877F2;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-weight: bold;
    cursor: pointer;
    font-size: 12px;
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 999;
  `;
  
  // Add click event
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Get ad data
    const adData = extractAdData(container);
    
    // Visual feedback during process
    button.textContent = 'Processing...';
    
    try {
      // Generate filename with the advertiser name and library ID
      let fileName = 'fb_ad';
      if (adData.advertiserName) {
        // Create a safe filename by removing special characters
        const safeAdvertiserName = adData.advertiserName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        fileName = `${safeAdvertiserName}`;
      }
      if (adData.libraryId) {
        fileName += `_${adData.libraryId}`;
      }
      
      // Add timestamp to ensure uniqueness
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      fileName += `_${timestamp}`;
      
      // Download the JSON
      // downloadJSON(adData, `${fileName}.json`);
      
      // Visual feedback on success
      button.textContent = 'Downloaded!';
      button.style.backgroundColor = '#4BB543'; // Green on success
      
      // Log to console for additional debugging
      console.log('Extracted Ad Data:', adData);
    } catch (error) {
      // Visual feedback on error
      button.textContent = 'Error!';
      button.style.backgroundColor = '#FF0000'; // Red on error
      console.error('Failed to download:', error);
    }
    
    // Reset after 2 seconds
    setTimeout(() => {
      button.textContent = 'Download JSON';
      button.style.backgroundColor = '#1877F2';
    }, 2000);
  });
  
  // Add the button to the container
  container.style.position = 'relative';
  container.appendChild(button);
}

// Find ad containers and add buttons
function addButtonsToAds() {
  // Based on the actual HTML, this is the most reliable selector
  document.querySelectorAll('.xh8yej3 > ._7jvw').forEach(container => {
    // Skip containers that are too small
    if (container.offsetWidth < 100 || container.offsetHeight < 100) {
      return;
    }
    
    addButtonToContainer(container);
  });
}

// Set up observer to watch for new ads being loaded
const observer = new MutationObserver(addButtonsToAds);
observer.observe(document.body, { childList: true, subtree: true });

// Initial run to add buttons to existing ads
addButtonsToAds();

// Run when user scrolls to catch any new ads
window.addEventListener('scroll', addButtonsToAds);

// Console log to show the extension is loaded
console.log("Facebook Ads Library Scraper loaded!");
