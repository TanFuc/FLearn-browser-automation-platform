let state = {
    isPaused: false,
    isStopped: false
};

module.exports = {
    getBotState: () => state,
    setBotState: (newState) => {
        state = { ...state, ...newState };
    }
};
