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

define([
    "react",
], function(React) {

"use strict";

/* Show details for an alert, including possible solutions */
var SELinuxEventDetails = React.createClass({
    render: function() {
        if (!this.props.details) {
            // details should be requested by default, so we just need to wait for them
            return (
                <EmptyState
                    icon={ <div className="spinner spinner-lg" /> }
                    description="Waiting for details..."
                    message={ null } />
            );
        }
        var self = this;
        var fix_entries = this.props.details.plugin_analysis.map(function(itm) {
            var fixit = null;
            if (itm.fixable) {
                fixit = (
                    <div className="setroubleshoot-listing-action">
                        <button className="btn btn-default"
                                onClick={ self.props.run_fix.bind(self, self.props.details.local_id, itm.analysis_id) }
                            >Apply this solution
                        </button>
                    </div>
                  );
            } else {
                fixit = (
                    <div className="setroubleshoot-listing-action">
                        <span>Unable to apply this solution automatically</span>
                    </div>
                  );
            }
            return (
                <div className="list-group-item" key={ itm.analysis_id }>
                    { fixit }
                    <div className="list-view-pf-main-info">
                        <div className="list-view-pf-left">
                            <span>{ itm.if_text }</span>
                        </div>
                        <div className="list-view-pf-body">
                            <div className="list-view-pf-description">
                                <div className="list-group-item-text">
                                    { itm.then_text }
                                </div>
                            </div>
                            <div className="list-view-pf-additional-info">
                                { itm.do_text }
                            </div>
                        </div>
                    </div>
                </div>
            );
        });
        return (
          <div className="list-group list-view-pf">
              { fix_entries }
          </div>
        );
    }
});

/* Show the audit log events for an alert */
var SELinuxEventLog = React.createClass({
    render: function() {
        var self = this;
        var log_entries = this.props.details.audit_event.map(function(itm, idx) {
            // use the alert id and index in the event log array as the data key for react
            // if the log becomes dynamic, the entire log line might need to be considered as the key
            return (<div key={ self.props.details.local_id + "." + idx }>{ itm }</div>);
        });
        return (
            <div className="setroubleshoot-log">{ log_entries }</div>
        );
    }
});

/* entry for an alert in the listing, can be expanded (with details) or standard */
var SELinuxEvent = React.createClass({
    tab_renderers: [
        { name: "Solutions",
          renderer: SELinuxEventDetails,
        },
        { name: "Audit log",
          renderer: SELinuxEventLog,
        },
    ],
    getInitialState: function() {
        return {
            expanded: false, // show extended info, one line summary if false
            active_tab: 0, // currently active tab in expanded mode, defaults to first tab
        };
    },
    handleClick: function() {
        this.setState( {expanded: !this.state.expanded });
    },
    handleDismissClick: function(e) {
        e.stopPropagation();
    },
    handleTabClick: function(tab_idx, e) {
        this.setState( {active_tab: tab_idx } );
        e.stopPropagation();
        e.preventDefault();
    },
    render: function() {
        var self = this;
        var bodyProps = {className: '', onClick: this.handleClick};
        var count_display = null;
        if (this.state.expanded) {
            if (this.props.count > 1)
                count_display = <span className="pull-right">{ this.props.count + " occurrences"}</span>;
            var links = this.tab_renderers.map(function(itm, idx) {
                return (
                    <li key={ idx } className={ (idx === self.state.active_tab) ? "active" : ""} >
                        <a href="#" onClick={ self.handleTabClick.bind(self, idx) }>{ itm.name }</a>
                    </li>
                );
            });
            var active_renderer = this.tab_renderers[this.state.active_tab].renderer;
            return (
                <tbody className="open">
                    <tr className="listing-item" onClick={ this.handleClick } />
                    <tr className="listing-panel">
                        <td colSpan="2">
                            <div className="listing-head"  onClick={ this.handleClick }>
                                <div className="listing-actions">
                                     <button title="Dismiss"
                                            className="pficon pficon-delete btn btn-danger"
                                            disabled
                                            onClick={ this.handleDismissClick }>
                                    </button>
                                </div>
                                <h3>{this.props.description}</h3>
                                { count_display }
                                <ul className="nav nav-tabs nav-tabs-pf">
                                    { links }
                                </ul>
                            </div>
                            <div className="listing-body">
                                { React.createElement(active_renderer, this.props) }
                            </div>
                        </td>
                    </tr>
                </tbody>
            );
        } else {
            if (this.props.count > 1)
                count_display = <span className="badge">{ this.props.count }</span>;
            return (
                <tbody>
                    <tr className="listing-item" onClick={ this.handleClick }>
                        <td>{ this.props.description }</td>
                        <td>{ count_display }</td>
                    </tr>
                    <tr className="listing-panel" onClick={ this.handleClick } />
                </tbody>
            );
        }
    }
});

/* Implements a subset of the PatternFly Empty State pattern
 * https://www.patternfly.org/patterns/empty-state/
 */
var EmptyState = React.createClass({
    render: function() {
        var description = null;
        if (this.props.description)
            description = <h1>{this.props.description}</h1>;

        var message = null;
        if (this.props.message)
            message = <p>{this.props.message}</p>;

        return (
            <div className="curtains blank-slate-pf">
                <div className="blank-slate-pf-icon">
                    { this.props.icon }
                </div>
                { description }
                { message }
            </div>
        );
    }
});

/* The listing only shows if we have a connection to the dbus API
 * Otherwise we have blank slate: trying to connect, error
 */
var SETroubleshootPage = React.createClass({
    render: function() {
        var self = this;
        if (!this.props.connected) {
            var icon;
            var description;
            if (this.props.connecting) {
                icon = <div className="spinner spinner-lg" />;
                description = "Connecting...";
            } else {
                icon = <i className="fa fa-exclamation-circle" />;
                description = "Couldn't connect to SETroubleshoot daemon";
            }

            return (
                <EmptyState
                    icon={ icon }
                    description={ description }
                    message={ this.props.error } />
            );
        } else {
            // if we don't have any entries, show a sane message instead of an empty page */
            if (this.props.entries.length === 0) {
                return (
                    <EmptyState
                        icon={ <i className="fa fa-check" /> }
                        description="No SELinux alerts."
                        message={ null } />
                );
            }
            var entries = this.props.entries.map(function(itm) {
                itm.run_fix = self.props.run_fix;
                return <SELinuxEvent { ...itm } />;
            });
            return (
                <div className="container-fluid setroubleshoot-page">
                    <table className="listing setroubleshoot-listing">
                        <thead>
                            <tr>
                                <td colSpan="2">
                                    <h3>SELinux Access Control errors</h3>
                                </td>
                            </tr>
                        </thead>
                        {entries}
                    </table>
                </div>
            );
        }
    }
});

return {
    SETroubleshootPage: SETroubleshootPage,
};

});

