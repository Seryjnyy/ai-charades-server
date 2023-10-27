// Array shuffle function from the npm package
// a quick hack because node js wasn't having it, strange error about not supporting require() of ES Module
export function arrayShuffle(array: any) {
    if (!Array.isArray(array)) {
        throw new TypeError(`Expected an array, got ${typeof array}`);
    }

    array = [...array];

    for (let index = array.length - 1; index > 0; index--) {
        const newIndex = Math.floor(Math.random() * (index + 1));
        [array[index], array[newIndex]] = [array[newIndex], array[index]];
    }

    return array;
}
