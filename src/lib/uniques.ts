import * as admin from 'firebase-admin';

const db = admin.firestore();

// unique field functions

module.exports = {
    /**
     * Creates a unique field index
     * @param colPath - collection / field path
     * @param field 
     * @param fkName 
     * @param fkVal 
     * @param uniqueCol 
     */
    createField: async function (colPath: string, field: string, fkName: string, fkVal: string, uniqueCol = '_uniques'): Promise<any> {

        const titleRef = db.doc(`${uniqueCol}/${colPath}/${field}`);
        return titleRef.set({ [fkName]: fkVal });
    },
    /**
     * Deletes a unique field index
     * @param colPath - collection / field path
     * @param field 
     * @param uniqueCol 
     */
    deleteField: async function (colPath: string, field: string, uniqueCol = '_uniques'): Promise<any> {

        const titleRef = db.doc(`${uniqueCol}/${colPath}/${field}`);
        return titleRef.delete();
    },
    /**
     * Updates a unique field index
     * @param colPath - collection / field path
     * @param oldField 
     * @param newField 
     * @param fkName 
     * @param fkVal 
     * @param uniqueCol 
     */
    updateField: async function (colPath: string, oldField: string, newField: string, fkName: string, fkVal: string, uniqueCol = '_uniques'): Promise<any> {

        const oldTitleRef = db.doc(`${uniqueCol}/${colPath}/${oldField}`);
        const newTitleRef = db.doc(`${uniqueCol}/${colPath}/${newField}`);
        const batch = db.batch();

        batch.delete(oldTitleRef);
        batch.create(newTitleRef, { [fkName]: fkVal });

        return batch.commit();
    }
}
