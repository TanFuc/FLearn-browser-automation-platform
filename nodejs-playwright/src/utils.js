const randomDelay = (min = 1000, max = 3000) => 
    new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));

module.exports = {
    randomDelay
};
