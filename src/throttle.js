const sleep = async milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export default (maxNumberOfRequests, windowMilliseconds = 1000) => {
  const activeCount = {};
  const waitQueue = {};

  const checkForNext = key => {
    if (waitQueue[key].length === 0 || activeCount[key] >= maxNumberOfRequests) return;
    const resolve = waitQueue[key].shift();
    activeCount[key] += 1;
    resolve(async () => {
      await sleep(windowMilliseconds);
      activeCount[key] -= 1;
      if (waitQueue[key].length > 0) {
        checkForNext(key);
      } else if (activeCount[key] === 0) {
        delete activeCount[key];
        delete waitQueue[key];
      }
    });
  };

  return async key => {
    if (!(key in activeCount)) {
      activeCount[key] = 0;
      waitQueue[key] = [];
    }
    const promise = new Promise(resolve => {
      waitQueue[key].push(resolve);
    });

    checkForNext(key);
    return promise;
  };
};
