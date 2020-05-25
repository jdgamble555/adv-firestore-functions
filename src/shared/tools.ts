import * as admin from 'firebase-admin';
try { admin.initializeApp(); } catch (e) { }

export {
    arrayChunk,
    getCatArray,
    arraysEqual,
    findSingleValues,
    canContinue,
    getFriendlyURL,
    isTriggerFunction,
    valueIsChanged,
    triggerFunction
}
/**
* Return a friendly url for the db
* @param url
*/
function getFriendlyURL(url: string): string {
    // create friendly URL
    return url
        .trim()
        .toLowerCase()
        .replace(/^[^a-z\d]*|[^a-z\d]*$/gi, '') // trim other characters as well
        .replace(/-/g, ' ')
        .replace(/[^\w ]+/g, '')
        .replace(/ +/g, '-');
}
/**
 * Determines if is an update or create trigger function
 * @param after 
 * @param before 
 */
function canContinue(after: any, before: any): boolean {
    // if update trigger
    if (before.updatedAt && after.updatedAt) {
        if (after.updatedAt._seconds !== before.updatedAt._seconds) {
            return false;
        }
    }
    // if create trigger
    if (!before.createdAt && after.createdAt) {
        return false;
    }
    return true;
}
/**
 * Check for trigger function
 * @param change 
 */
function isTriggerFunction(change: any) {

    // simplify input data
    const after: any = change.after.exists ? change.after.data() : null;
    const before: any = change.before.exists ? change.before.data() : null;

    const updateDoc = change.before.exists && change.after.exists;

    if (updateDoc && !canContinue(after, before)) {
        console.log("Trigger function run");
        return true;
    }
    return false;
}
/**
* Gets the unique values from the combined array
* @param a1 
* @param a2 
* @return - unique values array
*/
function findSingleValues(a1: Array<any>, a2: Array<any>): Array<any> {

    return a1.concat(a2).filter((v: any) => {
        if (!a1.includes(v) || !a2.includes(v)) {
            return v;
        }
    });
}
/**
 * Determine if arrays are equal
 * @param a1 
 * @param a2 
 * @return - boolean
 */
function arraysEqual(a1: Array<any>, a2: Array<any>): boolean {
    return JSON.stringify(a1) === JSON.stringify(a2);
}
/**
 * Determine if a field value has been updated
 * @param change 
 * @param val 
 */
function valueIsChanged(change: any, val: string): boolean {

    // simplify input data
    const after: any = change.after.exists ? change.after.data() : null;
    const before: any = change.before.exists ? change.before.data() : null;

    if (!before || !after || !before[val] || !after[val]) {
        return true;
    }
    if (arraysEqual(before[val], after[val])) {
        return false;
    }
    return true;    
}
/**
 * Returns the category array
 * @param category 
 */
function getCatArray(category: string): Array<any> {

    // create catPath and catArray
    const catArray: Array<String> = [];
    let cat = category;

    while (cat !== '') {
        catArray.push(cat);
        cat = cat.split('/').slice(0, -1).join('/');
    }
    return catArray;
}
/**
 * trigger Function to update dates and filtered values
 * @param change 
 * @param data 
 * @param dates 
 */
async function triggerFunction(change: any, data: any = {}, dates = true) {

    // simplify event types
    const createDoc = change.after.exists && !change.before.exists;
    const updateDoc = change.before.exists && change.after.exists;

    if (dates) {
        if (createDoc) {
            // createdAt
            data.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }
        if (updateDoc) {
            // updatedAt
            data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        }
    }
    if (Object.keys(data).length) {
        console.log("Running function again to update data:", JSON.stringify(data));
        await change.after.ref
            .set(data, { merge: true })
            .catch((e: any) => {
                console.log(e);
            });
    }
    return null;
}
/**
 * loop through arrays in chunks
 */
class arrayChunk {

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