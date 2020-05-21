// common tools functions
import * as admin from 'firebase-admin';

module.exports = {
    /**
    * Return a friendly url for the db
    * @param url
    */
    getFriendlyURL: function (url: string): string {
        // create friendly URL
        return url
            .trim()
            .toLowerCase()
            .replace(/^[^a-z\d]*|[^a-z\d]*$/gi, '') // trim other characters as well
            .replace(/-/g, ' ')
            .replace(/[^\w ]+/g, '')
            .replace(/ +/g, '-');
    },
    /**
     * Determines if is a trigger function
     * @param after 
     * @param before 
     */
    canContinue: function (after: any, before: any): boolean {
        // if update trigger (arrayCat and catPath triggers as well)
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
    },
    /**
    * Gets the unique values from the combined array
    * @param a1 
    * @param a2 
    * @return - unique values array
    */
    findSingleValues: function (a1: Array<any>, a2: Array<any>): Array<any> {

        return a1.concat(a2).filter((v: any) => {
            if (!a1.includes(v) || !a2.includes(v)) {
                return v;
            }
        });
    },
    /**
     * Determine if arrays are equal
     * @param a1 
     * @param a2 
     * @return - boolean
     */
    arraysEqual: function (a1: Array<any>, a2: Array<any>): boolean {
        return JSON.stringify(a1) === JSON.stringify(a2);
    },
    /**
     * Returns the category array
     * @param category 
     */
    getCatArray: function (category: string): Array<any> {

        // create catPath and catArray
        const catArray: Array<String> = [];
        let cat = category;

        while (cat !== '') {
            catArray.push(cat);
            cat = cat.split('/').slice(0, -1).join('/');
        }
        return catArray;
    }
};