// Meeting Scheduler Backend with Push Notifications

class MeetingScheduler {
    constructor() {
        this.meetings = this.loadMeetings();
        // Track sent notifications per meeting by threshold (e.g. 5, 1)
        this.notifiedMeetings = new Map();
        this.checkInterval = null;
        this.isPageVisible = true;
        this.audioContext = null; // shared AudioContext to comply with autoplay policies
        this.audioUnlocked = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.requestNotificationPermission();
        this.registerServiceWorker();
        this.setupVisibilityListener();
        this.setupAudioUnlock();
        this.setDefaultMeetLink();
        this.renderMeetings();
        this.startCheckingMeetings();
    }

    setupEventListeners() {
        const form = document.getElementById('meeting-form');
        form.addEventListener('submit', (e) => this.handleFormSubmit(e));

        // Add test notification button
        const testBtn = document.getElementById('test-notification-btn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.testNotification());
        }

        const openMeetBtn = document.getElementById('open-meet-btn');
        if (openMeetBtn) {
            openMeetBtn.addEventListener('click', () => this.openGoogleMeet());
        }
    }

    // Unlock/resume AudioContext on first user gesture (required by many browsers/hosts)
    setupAudioUnlock() {
        const unlock = async () => {
            if (!this.audioContext) {
                try {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) {
                    console.log('AudioContext creation failed:', e && e.message);
                    return;
                }
            }

            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                    console.log('AudioContext resumed after user gesture');
                } catch (e) {
                    console.log('AudioContext resume failed:', e && e.message);
                }
            }

            this.audioUnlocked = true;

            // remove listeners (we used once: true below but ensure cleanup)
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
            document.removeEventListener('touchstart', unlock);
        };

        // Add one-time listeners to resume audio on first user gesture
        document.addEventListener('click', unlock, { once: true, passive: true });
        document.addEventListener('keydown', unlock, { once: true, passive: true });
        document.addEventListener('touchstart', unlock, { once: true, passive: true });
    }

    // Request permission for system notifications
    requestNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        console.log('Notifications enabled');
                    }
                });
            }
        }
    }

    // Register Service Worker for better notification support
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('data:application/javascript;base64,' + btoa(`
self.addEventListener('push', event => {
    const options = event.data.json();
    self.registration.showNotification(options.title, options);
});
`)).catch(err => console.log('Service Worker registration failed'));
        }
    }

    // Track when user switches to another tab/window
    setupVisibilityListener() {
        document.addEventListener('visibilitychange', () => {
            this.isPageVisible = !document.hidden;
        });

        window.addEventListener('blur', () => {
            this.isPageVisible = false;
        });

        window.addEventListener('focus', () => {
            this.isPageVisible = true;
        });
    }

    handleFormSubmit(e) {
        e.preventDefault();

        const title = document.getElementById('title').value;
        const date = document.getElementById('date').value;
        const time = document.getElementById('time').value;
        const duration = parseInt(document.getElementById('duration').value);
        const phone = document.getElementById('phone').value;
        const meetLinkInput = document.getElementById('meet-link');
        let meetLink = this.normalizeMeetLink(meetLinkInput.value);

        if (!meetLink) {
            meetLink = 'https://meet.google.com/new';
            meetLinkInput.value = meetLink;
            this.openGoogleMeet();
        }

        if (!title || !date || !time || !duration || !phone || !meetLink) {
            this.showAlert('Please fill in all fields');
            return;
        }

        const meeting = {
            id: Date.now(),
            title,
            date,
            time,
            duration,
            phone: this.normalizePhone(phone),
            meetLink: meetLink,
            createdAt: new Date().toISOString()
        };

        this.meetings.push(meeting);
        this.saveMeetings();
        this.renderMeetings();

        // Reset form
        document.getElementById('meeting-form').reset();
        this.showAlert(`Meeting "${title}" scheduled successfully!`);
        
        // Check for notifications immediately after scheduling
        setTimeout(() => {
            this.checkUpcomingMeetings();
        }, 500);
    }

    saveMeetings() {
        localStorage.setItem('meetings', JSON.stringify(this.meetings));
    }

    loadMeetings() {
        const stored = localStorage.getItem('meetings');
        return stored ? JSON.parse(stored) : [];
    }

    renderMeetings() {
        const list = document.getElementById('meetings-list');
        
        if (this.meetings.length === 0) {
            list.innerHTML = '<p class="empty-message">No meetings scheduled</p>';
            return;
        }

        // Sort meetings by date and time
        const sorted = [...this.meetings].sort((a, b) => {
            const dateA = new Date(`${a.date}T${a.time}`);
            const dateB = new Date(`${b.date}T${b.time}`);
            return dateA - dateB;
        });

        list.innerHTML = sorted.map(meeting => this.createMeetingElement(meeting)).join('');

        // Add event listeners to remove buttons
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                this.removeMeeting(id);
            });
        });

        // Ensure action links open reliably (some hosts/browsers block direct link opens)
        document.querySelectorAll('.meet-link, .host-link, .whatsapp-link, .sms-link').forEach(link => {
            link.addEventListener('click', (e) => {
                const href = link.getAttribute('href');
                if (!href) {
                    return;
                }

                // SMS links should navigate in the same window on mobile
                if (href.startsWith('sms:')) {
                    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                    if (!isMobile) {
                        this.showAlert('SMS links open on mobile devices. If you are on desktop, use WhatsApp or copy the link.');
                    }

                    window.location.href = href;
                    e.preventDefault();
                    return;
                }

                const opened = window.open(href, link.getAttribute('target') || '_blank', 'noopener');
                if (!opened) {
                    this.showAlert('Popup blocked. Please allow popups for this site and try again.');
                }

                e.preventDefault();
            });
        });

        document.querySelectorAll('.copy-sms-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.currentTarget.dataset.id, 10);
                this.copySmsText(id);
            });
        });
    }

    createMeetingElement(meeting) {
        const meetingDateTime = new Date(`${meeting.date}T${meeting.time}`);
        const now = new Date();
        const timeDiff = meetingDateTime - now;
        const minutesUntil = Math.floor(timeDiff / 60000);
        
        const isUpcoming = timeDiff > 0 && timeDiff <= 5 * 60000;
        const isPast = timeDiff < 0;

        let timeStatus = '';
        if (isPast) {
            timeStatus = '<span style="color: #999; font-size: 0.85rem;">Past Meeting</span>';
        } else if (isUpcoming) {
            timeStatus = `<span style="color: #ff6b6b; font-weight: bold; font-size: 0.85rem;">⚠️ Starts in ${minutesUntil} min</span>`;
        } else {
            timeStatus = `<span style="color: #667eea; font-size: 0.85rem;">in ${this.formatTimeUntil(timeDiff)}</span>`;
        }

        const endTime = new Date(meetingDateTime.getTime() + meeting.duration * 60000);
        const formattedDate = new Date(meeting.date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });

        const hasMeetLink = Boolean(meeting.meetLink);
        const hasPhone = Boolean(meeting.phone);

        const linksHtml = hasMeetLink || hasPhone ? `
            <div class="meeting-links">
                ${hasMeetLink ? `<a class="meet-link" href="${this.escapeHtml(meeting.meetLink)}" target="_blank" rel="noopener">Open Meet</a>` : ''}
                ${hasMeetLink ? `<a class="host-link" href="${this.escapeHtml(meeting.meetLink)}" target="_blank" rel="noopener">Open as Host</a>` : ''}
                ${hasPhone && hasMeetLink ? `<a class="whatsapp-link" href="${this.buildWhatsAppLink(meeting)}" target="_blank" rel="noopener">Send WhatsApp</a>` : ''}
                ${hasPhone && hasMeetLink ? `<a class="sms-link" href="${this.buildSmsLink(meeting)}">Send SMS</a>` : ''}
                ${hasPhone && hasMeetLink ? `<button class="copy-sms-btn" type="button" data-id="${meeting.id}">Copy SMS</button>` : ''}
            </div>
            <div class="meeting-note">
                Auto-admit is controlled by the host's Google Meet settings. Open as host to admit others.
            </div>
        ` : '';

        return `
            <div class="meeting-item ${isUpcoming ? 'upcoming' : ''}">
                <button class="remove-btn" data-id="${meeting.id}" title="Remove meeting">×</button>
                <div class="meeting-title">${this.escapeHtml(meeting.title)}</div>
                <div class="meeting-details">
                    <div class="meeting-time">
                        ${formattedDate} at ${meeting.time} ${timeStatus}
                    </div>
                    <div class="meeting-duration">
                        ${meeting.duration} minutes
                    </div>
                    <div style="color: #999; font-size: 0.85rem; margin-top: 5px;">
                        Ends at ${endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    ${linksHtml}
                </div>
            </div>
        `;
    }

    formatTimeUntil(milliseconds) {
        const minutes = Math.floor(milliseconds / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days} day${days > 1 ? 's' : ''}`;
        }
        if (hours > 0) {
            return `${hours} hour${hours > 1 ? 's' : ''}`;
        }
        return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }

    removeMeeting(id) {
        this.meetings = this.meetings.filter(m => m.id !== id);
        this.notifiedMeetings.delete(id);
        this.saveMeetings();
        this.renderMeetings();
    }

    startCheckingMeetings() {
        // Check every 2 seconds for upcoming meetings (much faster response)
        this.checkInterval = setInterval(() => {
            this.checkUpcomingMeetings();
        }, 2000);

        // Also check immediately
        this.checkUpcomingMeetings();
    }

    checkUpcomingMeetings() {
        const now = new Date();

        this.meetings.forEach(meeting => {
            const meetingDateTime = new Date(`${meeting.date}T${meeting.time}`);
            const timeDiff = meetingDateTime - now;
            const secondsUntil = Math.floor(timeDiff / 1000);
            const minutesUntil = Math.ceil(secondsUntil / 60);

            if (timeDiff > 0) {
                // Ensure map entry exists
                if (!this.notifiedMeetings.has(meeting.id)) {
                    this.notifiedMeetings.set(meeting.id, new Set());
                }

                const sentSet = this.notifiedMeetings.get(meeting.id);

                // 5-minute notification (informational)
                if (secondsUntil <= 300 && secondsUntil > 60 && !sentSet.has(5)) {
                    this.showNotification(meeting, minutesUntil);
                    this.sendSystemNotification(meeting, minutesUntil);
                    sentSet.add(5);
                }

                // 1-minute notification (attention: popup + sound)
                if (secondsUntil <= 60 && !sentSet.has(1)) {
                    this.showNotification(meeting, minutesUntil);
                    this.sendSystemNotification(meeting, minutesUntil);
                    this.playNotificationSound();
                    sentSet.add(1);
                }
            }

            // Clear notification flags after meeting time has passed
            if (timeDiff < 0) {
                this.notifiedMeetings.delete(meeting.id);
            }
        });

        // Update the meetings list to reflect latest status
        this.renderMeetings();
    }

    // In-app popup notification
    showNotification(meeting, minutesUntil) {
        const notificationText = document.getElementById('notification-text');
        const popup = document.getElementById('notification-popup');

        let message = `<strong>${this.escapeHtml(meeting.title)}</strong><br>`;
        message += `Starts at ${meeting.time}<br>`;
        message += `Duration: ${meeting.duration} minutes<br><br>`;

        if (minutesUntil > 0) {
            message += `Starting in <strong>${minutesUntil} minute${minutesUntil > 1 ? 's' : ''}</strong>!`;
        } else {
            message += `<strong>Starting NOW!</strong>`;
        }

        notificationText.innerHTML = message;
        popup.classList.remove('hidden');

        // Auto-dismiss after 10 seconds
        setTimeout(() => {
            this.dismissNotification();
        }, 10000);
    }

    // System notification - shows on phone & other windows
    sendSystemNotification(meeting, minutesUntil) {
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                let title = `📅 Meeting: ${meeting.title}`;
                let message = '';

                if (minutesUntil > 0) {
                    message = `Starts in ${minutesUntil} minute${minutesUntil > 1 ? 's' : ''} at ${meeting.time}`;
                } else {
                    message = `Starting NOW! at ${meeting.time}`;
                }

                const options = {
                    body: message,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="80" font-size="80" text-anchor="middle">📅</text></svg>',
                    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23667eea"/><text x="50" y="70" font-size="50" text-anchor="middle" fill="white">!</text></svg>',
                    tag: `meeting-${meeting.id}`,
                    requireInteraction: minutesUntil <= 1,
                    vibrate: [200, 100, 200, 100, 200],
                    timestamp: Date.now(),
                    actions: [
                        {
                            action: 'open',
                            title: 'Got it! 👍'
                        }
                    ]
                };

                const notification = new Notification(title, options);
                console.log('🔔 System notification sent:', title);

                // Handle notification click
                notification.onclick = () => {
                    notification.close();
                    if (window) {
                        window.focus();
                    }
                };

                // Close notification after 15 seconds
                setTimeout(() => notification.close(), 15000);
            } else if (Notification.permission === 'default') {
                console.log('⚠️ Notification permission not granted. Requesting...');
                this.requestNotificationPermission();
            } else {
                console.log('❌ Notification permission denied');
            }
        } else {
            console.log('❌ Notifications not supported');
        }
    }

    playNotificationSound() {
        // Use shared AudioContext and resume if suspended (fixes autoplay blocking on hosts)
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const startPlayback = () => {
                const audioContext = this.audioContext;

                // Custom frequency sound
                const playFrequency = (frequency, duration, startTime, volume = 0.8) => {
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();

                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);

                    oscillator.frequency.value = frequency;
                    oscillator.type = 'sine';

                    gainNode.gain.setValueAtTime(volume, audioContext.currentTime + startTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + startTime + duration);

                    oscillator.start(audioContext.currentTime + startTime);
                    oscillator.stop(audioContext.currentTime + startTime + duration);
                };

                // Custom frequency pattern: 1600Hz → 1000Hz → 400Hz → 200Hz (descending)
                // Each tone plays for 1 second individually with small gaps
                playFrequency(1600, 1.0, 0, 0.85);      // Tone 1: 1600Hz for 1.0s
                playFrequency(1000, 1.0, 1.1, 0.85);    // Tone 2: 1000Hz for 1.0s (starts at 1.1s)
                playFrequency(400, 1.0, 2.2, 0.85);     // Tone 3: 400Hz for 1.0s (starts at 2.2s)
                playFrequency(200, 1.0, 3.3, 0.85);     // Tone 4: 200Hz for 1.0s (starts at 3.3s)

                console.log('🎵 Custom frequency notification sound played (shared AudioContext)');
            };

            if (this.audioContext.state === 'suspended') {
                // Try to resume, then play
                this.audioContext.resume().then(() => {
                    this.audioUnlocked = true;
                    startPlayback();
                }).catch(err => {
                    console.log('AudioContext resume failed:', err && err.message);
                    // attempt playback anyway
                    startPlayback();
                });
            } else {
                startPlayback();
            }
        } catch (e) {
            console.log('Audio notification not available:', e && e.message);
        }

        // Strong vibration feedback for mobile devices
        if (navigator.vibrate) {
            navigator.vibrate([150, 100, 150, 100, 150, 100, 200]);
            console.log('📳 Vibration triggered');
        }
    }

    showAlert(message) {
        alert(message);
    }

    openGoogleMeet() {
        window.open('https://meet.google.com/new', '_blank', 'noopener');
        this.showAlert('A new Google Meet tab opened. Copy the Meet link and paste it into the "Google Meet Link" field.');
    }

    setDefaultMeetLink() {
        const meetLinkInput = document.getElementById('meet-link');
        if (meetLinkInput && !meetLinkInput.value) {
            meetLinkInput.value = 'https://meet.google.com/new';
        }
    }

    normalizePhone(phone) {
        return phone.replace(/[^0-9]/g, '');
    }

    normalizeMeetLink(link) {
        const trimmed = (link || '').trim();
        if (!trimmed) {
            return '';
        }

        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
        }

        // Handle pasted links like meet.google.com/xxx-xxxx-xxx
        return `https://${trimmed}`;
    }

    buildWhatsAppLink(meeting) {
        const phone = this.normalizePhone(meeting.phone || '');
        const message = this.buildSmsMessage(meeting);
        const encoded = encodeURIComponent(message);
        return `https://wa.me/${phone}?text=${encoded}`;
    }

    buildSmsLink(meeting) {
        const phone = this.normalizePhone(meeting.phone || '');
        const message = this.buildSmsMessage(meeting);
        const encoded = encodeURIComponent(message);
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        const bodyParam = isIOS ? '&body=' : '?body=';
        return `sms:${phone}${bodyParam}${encoded}`;
    }

    buildSmsMessage(meeting) {
        return `Meeting: ${meeting.title}\nTime: ${meeting.date} ${meeting.time}\nDuration: ${meeting.duration} minutes\nJoin: ${meeting.meetLink}`;
    }

    copySmsText(meetingId) {
        const meeting = this.meetings.find(item => item.id === meetingId);
        if (!meeting) {
            this.showAlert('Could not find meeting details to copy.');
            return;
        }

        const message = this.buildSmsMessage(meeting);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(message).then(() => {
                this.showAlert('SMS text copied. Open your SMS app and paste it.');
            }).catch(() => {
                this.showAlert('Copy failed. Please select and copy the text manually.');
            });
        } else {
            this.showAlert(`Copy this SMS text:\n\n${message}`);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    dismissNotification() {
        document.getElementById('notification-popup').classList.add('hidden');
    }

    // Test notification - manual trigger
    testNotification() {
        console.log('🧪 Testing notification system...');
        
        const testMeeting = {
            id: Date.now(),
            title: 'Test Meeting',
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            date: new Date().toISOString().slice(0, 10),
            duration: 15,
            phone: '919876543210',
            meetLink: 'https://meet.google.com/new'
        };

        this.showNotification(testMeeting, 0);
        this.sendSystemNotification(testMeeting, 0);
        this.playNotificationSound();
        
        console.log('✅ Test notification triggered!');
    }

    stopChecking() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}

// Global function to dismiss notification
function dismissNotification() {
    if (window.scheduler) {
        window.scheduler.dismissNotification();
    }
}

// Initialize the scheduler when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.scheduler = new MeetingScheduler();
});

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
    if (window.scheduler) {
        window.scheduler.stopChecking();
    }
});