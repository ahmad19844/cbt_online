(function () {
  const attemptId = window.location.pathname.split('/').pop();
  let secondsRemaining = window.EXAM_SECONDS_REMAINING || 0;
  const timerEl = document.getElementById('timer');
  const form = document.getElementById('examForm');
  let submitting = false;

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function updateTimerDisplay() {
    timerEl.textContent = formatTime(secondsRemaining);
    if (secondsRemaining <= 60) {
      timerEl.classList.add('timer-warning');
    }
  }

  function autoSubmit() {
    if (submitting) return;
    submitting = true;
    timerEl.textContent = "Time's up — submitting...";
    form.submit();
  }

  updateTimerDisplay();
  const interval = setInterval(() => {
    secondsRemaining -= 1;
    if (secondsRemaining <= 0) {
      clearInterval(interval);
      secondsRemaining = 0;
      updateTimerDisplay();
      autoSubmit();
      return;
    }
    updateTimerDisplay();
  }, 1000);

  // Autosave each answer as the student selects it
  document.querySelectorAll('.answer-input').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const attemptQuestionId = e.target.dataset.attemptQuestionId;
      const selectedOption = e.target.value;
      try {
        await fetch(`/student/attempts/${attemptId}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attemptQuestionId, selectedOption })
        });
      } catch (err) {
        console.error('Could not save answer', err);
      }
    });
  });

  // Prevent double-submit and warn on manual submit
  form.addEventListener('submit', (e) => {
    if (submitting) {
      e.preventDefault();
      return;
    }
    submitting = true;
  });

  // Warn before leaving the page mid-exam
  window.addEventListener('beforeunload', (e) => {
    if (!submitting) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();
