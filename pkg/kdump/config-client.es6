/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from 'cockpit';

/* Parse an ini-style config file
 * and monitor it for changes
 */
export class ConfigFile {
    constructor(filename, superuser = false) {
        this.filename = filename;
        this._rawContent = undefined;
        this._lines = [ ];
        this._originalSettings = { };
        this._dataAvailable = cockpit.defer();
        this.settings = { };

        cockpit.event_target(this);

        this._fileHandle = cockpit.file(filename, { superuser: superuser } );
        var self = this;
        this._fileHandle.watch(function(rawContent) {
            self._parseText(rawContent);
        });
    }
    close() {
        if (this._fileHandle) {
            this._fileHandle.remove();
            this._fileHandle = undefined;
        }
    }
    // wait for data to have been read at least once
    wait() {
        return this._dataAvailable.promise();
    }
    /* parse lines of the config file
     * if a line has a valid config key, use that as key
     * and also store original line, line index, value and whether the line contains a comment
     * we care about the comment since we don't want to overwrite a user comment when changing a value
     * e.g. for line "someKey foo # comment"
     * outputObject["someKey"] = { index: 0, value: "foo", origLine: "someKey foo # comment", hasComment: true }
     * skipNotify: Don't notify about changes, e.g.to avoid multiple updates when writing a file
     */
    _parseText(rawContent, skipNotify) {
        if (this._dataAvailable)
            this._dataAvailable.resolve();

        var self = this;
        // if nothing changed, don't bother parsing the content
        if (rawContent == self._rawContent)
            return;

        if (skipNotify === undefined)
            skipNotify = false;

        self._rawContent = rawContent;
        // parse the config file
        self._lines = rawContent.split(/\r?\n/);

        self.settings = { };
        self._lines.forEach(function(line, index) {
            let trimmed = line.trimLeft();
            // if the line is empty or only a comment, skip
            if (trimmed.indexOf("#") === 0 || trimmed.length === 0)
                return;

            // we need to have a space between key and value
            let separatorIndex = trimmed.indexOf(" ");
            if (separatorIndex === -1)
                return;
            let key = trimmed.substring(0, separatorIndex);
            let value = trimmed.substring(separatorIndex+1).trim();

            // value might have a comment at the end
            let commentIndex = value.indexOf("#");
            let comment;
            if (commentIndex !== -1) {
                comment = value.substring(commentIndex).trim();
                value = value.substring(0, commentIndex).trim();
            }
            self.settings[key] = {
                index: index,
                value: value,
                origLine: line,
                comment: comment
            };
        });

        // make sure we copy the original keys so we overwrite the correct lines when saving
        self._originalSettings = { };
        Object.keys(self.settings).forEach(function(key) {
            self._originalSettings[key] = cockpit.extend({}, self.settings[key]);
        });
        if (!skipNotify)
            self.dispatchEvent("kdumpConfigChanged", this.settings);
    }

    /* generate the config file from raw text and settings
     */
    _generateConfig(settings) {
        var self = this;
        let lines = this._lines.slice(0);
        let linesToDelete = [];
        // first find the settings lines that have been disabled/deleted
        Object.keys(self._originalSettings).forEach(function(key) {
            if (!(key in settings))  {
                let origEntry = self._originalSettings[key];
                // if the line had a comment, keep it, otherwise delete
                if (origEntry.comment !== undefined)
                    lines[origEntry.index] = "#" + origEntry.origLine;
                else
                    linesToDelete.push(origEntry.index);
            }
        });
        // we take the lines from our last read operation and modify them with the new settings
        Object.keys(settings).forEach(function(key) {
            let entry = settings[key];
            let line = key + " " + entry.value;
            if (entry.comment)
                line = line + " " + entry.comment;
            // this might be a new entry
            if (!(key in self._originalSettings)) {
                lines.push(line);
                return;
            }
            // otherwise edit the old line
            let origEntry = self._originalSettings[key];
            lines[origEntry.index] = line;
        });
        // now delete the rows we want to delete
        linesToDelete.sort().reverse().forEach(function(lineIndex) {
            lines.splice(lineIndex, 1);
        });

        return lines.join("\n");
    }

    /* write settings back to file
     * new settings that don't have a corresponding entry already have an undefined or null index
     * returns a promise for the file operation (cockpit File)
     */
    write(settings) {
        var self = this;
        return self._fileHandle.modify(function(oldContent) {
            self._parseText(oldContent, true);
            return self._generateConfig(settings);
        });
    }
}
