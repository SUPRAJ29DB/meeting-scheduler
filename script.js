// Meeting Scheduler Backend with Push Notifications

class MeetingScheduler {
    constructor() {
        this.meetings = this.loadMeetings();
        this.notifiedMeetings = new Set();
        this.checkInterval = null;
        this.isPageVisible = true;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.requestNotificationPermission();
        this.registerServiceWorker();
        this.setupVisibilityListener();
        this.renderMeetings();
        this.startCheckingMeetings();
    }

    setupEventListeners() {
        const form = document.getElementById('meeting-form');
        form.addEventListener('submit', (e) => this.handleFormSubmit(e));
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

        if (!title || !date || !time || !duration) {
            this.showAlert('Please fill in all fields');
            return;
        }

        const meeting = {
            id: Date.now(),
            title,
            date,
            time,
            duration,
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
            const minutesUntil = Math.floor(timeDiff / 60000);

            // Show notification if meeting is within 5 minutes and not yet notified
            if (timeDiff > 0 && timeDiff <= 5 * 60000 && !this.notifiedMeetings.has(meeting.id)) {
                this.showNotification(meeting, minutesUntil);
                this.sendSystemNotification(meeting, minutesUntil);
                this.notifiedMeetings.add(meeting.id);
                this.playNotificationSound();
            }

            // Clear notification flag after meeting time has passed
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
        if ('Notification' in window && Notification.permission === 'granted') {
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
                requireInteraction: minutesUntil <= 2,
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

            // Handle notification click
            notification.onclick = () => {
                notification.close();
                if (window) {
                    window.focus();
                }
            };

            // Close notification after 15 seconds
            setTimeout(() => notification.close(), 15000);
        }
    }

    playNotificationSound() {
        // Create a multiple beep sound using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            const playBeep = (frequency, duration, startTime) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = frequency;
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

                oscillator.start(audioContext.currentTime + startTime);
                oscillator.stop(audioContext.currentTime + startTime + duration);
            };

            // Play 3 beeps
            playBeep(800, 0.2, 0);
            playBeep(900, 0.2, 0.3);
            playBeep(800, 0.3, 0.6);
        } catch (e) {
            console.log('Audio notification not available');
        }
    }

    showAlert(message) {
        alert(message);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    dismissNotification() {
        document.getElementById('notification-popup').classList.add('hidden');
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