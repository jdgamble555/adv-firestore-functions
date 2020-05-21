
/**
 * An array chunking class for firebase functions
 * 
 * Usage Example:
 * 
 * let me = new array_chunk([5, 4, 3, 2, 1, 3, 2, 4], 3);
 * me.forEachChunk((chunkArray: any[]) => {
 *   console.log("chunk");
 *   chunkArray.forEach((ca) => {
 *     console.log(ca);
 *   })
 *   return chunkArray;
 * });
 *  
 */
export class arrayChunk {

    arr: any[];
    chunk: number;

    constructor(arr: any[], chunk = 100) {
        this.arr = arr;
        this.chunk = chunk;
    }

    forEachChunk(funct: Function) {
        for (let i = 0, j = this.arr.length; i < j; i += this.chunk) {
            const tempArray = this.arr.slice(i, i + this.chunk);
            funct(tempArray);
        }
    }
}
