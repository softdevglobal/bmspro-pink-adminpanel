"use client";
import React, { useState } from "react";
import Script from "next/script";
import Sidebar from "@/components/Sidebar";

export default function AttendancePage() {
  const [activeView, setActiveView] = useState<"dashboard" | "timesheets">("dashboard");
  const [mapStatus, setMapStatus] = useState<"match" | "mismatch">("mismatch");
  const [filterBranch, setFilterBranch] = useState("all");
  const [filterStaff, setFilterStaff] = useState("all");
  const [mobileOpen, setMobileOpen] = useState(false);

  const switchView = (view: "dashboard" | "timesheets") => {
    setActiveView(view);
  };

  const updateMap = (status: "match" | "mismatch") => {
    setMapStatus(status);
  };

  const applyFilters = (type: "branch" | "staff", value: string) => {
    if (type === "branch") setFilterBranch(value);
    if (type === "staff") setFilterStaff(value);
  };

  // Mock Data for filtering logic
  const staffCards = [
    { branch: "Lynbrook Warehouse", staff: "Mark Lee", name: "Mark Lee", initials: "ML", date: "Dec 06", status: "On Track", shift: "7h 0m", clockIn: "09:00 AM", breakStart: "12:00 PM", breakEnd: "01:00 PM", clockOut: "05:00 PM", variance: false },
    { branch: "Lynbrook Warehouse", staff: "Sarah Jenkins", name: "Sarah Jenkins", initials: "SJ", date: "Dec 06", status: "Review Needed", shift: "7h 0m", clockIn: "08:55 AM", breakStart: "12:05 PM", breakEnd: "01:00 PM", clockOut: "05:00 PM", variance: true, varianceText: "5km Variance" }
  ];

  const filteredStaff = staffCards.filter(card => {
    const matchBranch = filterBranch === "all" || card.branch === filterBranch;
    const matchStaff = filterStaff === "all" || card.staff === filterStaff;
    return matchBranch && matchStaff;
  });

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-inter text-slate-800">
      <Script src="https://unpkg.com/lucide@latest" onLoad={() => {
        // @ts-ignore
        if (window.lucide) window.lucide.createIcons();
      }} />

      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Main Scrollable Area */}
        <main className="flex-1 overflow-auto">
          
          {/* Mobile Toggle */}
          <div className="md:hidden p-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
             <h2 className="font-bold text-lg text-slate-800">Attendance</h2>
             <button
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => setMobileOpen(true)}
            >
              <i className="fas fa-bars" />
            </button>
          </div>

          {mobileOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div
                className="absolute inset-0 bg-black/40"
                onClick={() => setMobileOpen(false)}
              />
              <div className="absolute left-0 top-0 bottom-0">
                <Sidebar mobile onClose={() => setMobileOpen(false)} />
              </div>
            </div>
          )}

          {/* Page Content Container with Padding */}
          <div className="p-4 sm:p-6 lg:p-8">
            
            {/* Top Section: Card + Controls */}
            <div className="mb-6">
              <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-600 to-indigo-600 text-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <i className="fas fa-calendar-check" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">Staff Attendance</h1>
                    <p className="text-sm text-white/80 mt-1">Live Reconciliation, Timesheets & GPS</p>
                  </div>
                </div>
              </div>
            </div>

            {/* View Switcher Tabs */}
            <div className="flex justify-between items-center mb-4">
               <div />
               <div className="bg-white border border-slate-200 p-1 rounded-lg flex">
                  <button 
                    onClick={() => switchView('dashboard')}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${activeView === 'dashboard' ? 'bg-pink-50 text-pink-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Live Dashboard
                  </button>
                  <button 
                    onClick={() => switchView('timesheets')}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${activeView === 'timesheets' ? 'bg-pink-50 text-pink-600' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Timesheets & GPS
                  </button>
               </div>
               
               {activeView === 'dashboard' && (
                 <div className="hidden md:flex gap-4 text-sm items-center">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500"></span> 4 Active</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse"></span> 1 Exception</div>
                 </div>
               )}
               
               {activeView === 'timesheets' && (
                 <div className="flex gap-2">
                     <select 
                        onChange={(e) => applyFilters('branch', e.target.value)} 
                        className="pl-3 pr-8 py-1.5 bg-white border border-slate-200 text-sm rounded-md focus:ring-pink-500 outline-none"
                     >
                        <option value="all">All Branches</option>
                        <option value="Lynbrook Warehouse">Lynbrook Warehouse</option>
                        <option value="City Office">City Office</option>
                    </select>
                    <select 
                        onChange={(e) => applyFilters('staff', e.target.value)} 
                        className="pl-3 pr-8 py-1.5 bg-white border border-slate-200 text-sm rounded-md focus:ring-pink-500 outline-none"
                    >
                        <option value="all">All Staff</option>
                        <option value="Mark Lee">Mark Lee</option>
                        <option value="Sarah Jenkins">Sarah Jenkins</option>
                    </select>
                 </div>
               )}
            </div>

            {/* Views Container */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              
              {/* Dashboard View */}
              {activeView === 'dashboard' && (
                <div className="flex flex-col md:flex-row h-[600px]">
                  {/* Sidebar List */}
                  <div className="w-full md:w-1/3 border-r border-slate-200 bg-white flex flex-col">
                    <div className="p-4 bg-slate-50 border-b border-slate-200 font-semibold text-xs text-slate-500 uppercase">Staff On Shift</div>
                    <div className="overflow-y-auto flex-1">
                      <div onClick={() => updateMap('match')} className="p-4 border-b border-slate-100 hover:bg-slate-50 cursor-pointer group">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-bold text-slate-800">Sarah Jenkins</h4>
                            <p className="text-xs text-slate-500">Lynbrook Warehouse</p>
                          </div>
                          <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">MATCH</span>
                        </div>
                      </div>
                      <div onClick={() => updateMap('mismatch')} className="p-4 border-b border-slate-100 bg-pink-50/40 hover:bg-pink-50 cursor-pointer border-l-4 border-l-pink-500">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-bold text-slate-800">Mark Lee</h4>
                            <p className="text-xs text-slate-500">Lynbrook Warehouse</p>
                          </div>
                          <span className="bg-pink-100 text-pink-700 text-[10px] font-bold px-2 py-0.5 rounded-full">ALERT</span>
                        </div>
                        <p className="text-xs text-red-500 mt-2 font-mono">⚠ 1.5km Variance Detected</p>
                      </div>
                    </div>
                  </div>

                  {/* Map Area */}
                  <div className="flex-1 relative bg-slate-200 min-h-[300px]">
                     <div className="absolute inset-0 opacity-40 bg-[url('https://upload.wikimedia.org/wikipedia/commons/e/ec/Map_of_Lynbrook%2C_Victoria.png')] bg-cover bg-center grayscale"></div>
                     
                     <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
                        <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded mb-1 whitespace-nowrap">Job Site</div>
                        <i data-lucide="map-pin" className="w-8 h-8 text-blue-600 fill-blue-100"></i>
                     </div>

                     <div 
                       className={`absolute z-20 transition-all duration-500 ease-in-out flex flex-col items-center`}
                       style={{ 
                         top: mapStatus === 'match' ? '50%' : '30%', 
                         left: mapStatus === 'match' ? '50%' : '70%',
                         transform: 'translate(-50%, -50%)'
                       }}
                     >
                         <div className={`${mapStatus === 'match' ? 'bg-white border-green-200 text-green-600' : 'bg-white border-pink-200 text-pink-600'} border shadow-lg text-[10px] font-bold px-2 py-1 rounded mb-1 whitespace-nowrap text-center`}>
                             {mapStatus === 'match' ? 'Matched' : <>Mark Lee<br/>1.5km Away</>}
                         </div>
                         <i data-lucide="map-pin" className={`w-10 h-10 mx-auto ${mapStatus === 'match' ? 'text-green-600 fill-green-50' : 'text-pink-600 fill-pink-50 animate-bounce'}`}></i>
                     </div>
                  </div>
                </div>
              )}

              {/* Timesheets View */}
              {activeView === 'timesheets' && (
                <div className="flex flex-col">
                  <div className="p-6 space-y-6 bg-slate-50">
                      {filteredStaff.map((card, idx) => (
                          <div key={idx} className="staff-card bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                              <div className={`px-6 py-4 border-b border-slate-100 flex justify-between items-center ${card.variance ? 'bg-pink-50' : 'bg-slate-50'}`}>
                                  <div className="flex items-center gap-3">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${card.variance ? 'bg-white text-pink-600 border border-pink-100' : 'bg-slate-200 text-slate-600'}`}>
                                          {card.initials}
                                      </div>
                                      <div>
                                          <h3 className="font-bold text-slate-800">{card.name}</h3>
                                          <div className="text-xs text-slate-500">{card.branch} • {card.date}</div>
                                      </div>
                                  </div>
                                  <span className={`text-xs font-bold px-2 py-1 rounded ${card.variance ? 'bg-pink-600 text-white shadow-sm' : 'bg-green-100 text-green-700'}`}>
                                      {card.status}
                                  </span>
                              </div>

                              <div className="p-6">
                                  <div className={`flex items-center mb-6 ${card.variance ? 'opacity-50' : ''}`}>
                                      <div className="w-12 text-xs font-bold text-slate-400 uppercase tracking-wider">Shift</div>
                                      <div className="flex-1 h-8 bg-slate-100 rounded relative overflow-hidden flex items-center">
                                          <div className={`absolute h-full ${card.variance ? 'bg-slate-400' : 'bg-pink-500'}`} style={{left: '0%', width: '37.5%'}} title="Work"></div>
                                          <div className="absolute h-full bg-[repeating-linear-gradient(45deg,#f1f5f9_25%,transparent_25%,transparent_75%,#f1f5f9_75%,#f1f5f9),repeating-linear-gradient(45deg,#f1f5f9_25%,#f8fafc_25%,#f8fafc_75%,#f1f5f9_75%,#f1f5f9)] bg-[length:20px_20px] border-x border-white" style={{left: '37.5%', width: '12.5%'}} title="Unpaid Break"></div>
                                          <div className={`absolute h-full ${card.variance ? 'bg-slate-400' : 'bg-pink-500'}`} style={{left: '50%', width: '50%'}} title="Work"></div>
                                      </div>
                                      <div className="w-16 text-right text-sm font-bold text-slate-800 ml-4">{card.shift}</div>
                                  </div>

                                  <div className={`${card.variance ? 'bg-pink-50 border-pink-200' : 'bg-slate-50 border-slate-200'} rounded-lg border p-4`}>
                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                          <div>
                                              <div className={`${card.variance ? 'text-pink-700' : 'text-slate-400'} uppercase font-semibold mb-1 flex items-center gap-1`}>
                                                  {card.variance && <i data-lucide="alert-triangle" className="w-3 h-3"></i>} Clock In
                                              </div>
                                              <div className={`text-lg font-bold ${card.variance ? 'text-pink-700' : 'text-slate-800'}`}>{card.clockIn}</div>
                                              <div className={`mt-1 flex items-center gap-1 ${card.variance ? 'text-pink-700 border-pink-200' : 'text-slate-500 border-slate-200'} bg-white border rounded px-1.5 py-1 font-mono w-fit`}>
                                                  <i data-lucide="map-pin" className="w-3 h-3"></i> {card.variance ? '-38.10, 145.30' : '-38.05, 145.25'}
                                              </div>
                                              {card.variance && <div className="text-[10px] text-pink-600 mt-1 font-medium">{card.varianceText}</div>}
                                          </div>
                                          <div>
                                              <div className="text-slate-400 uppercase font-semibold mb-1">Break Start</div>
                                              <div className="text-lg font-medium text-slate-600">{card.breakStart}</div>
                                          </div>
                                          <div>
                                              <div className="text-slate-400 uppercase font-semibold mb-1">Break End</div>
                                              <div className="text-lg font-medium text-slate-600">{card.breakEnd}</div>
                                          </div>
                                          <div>
                                              <div className="text-slate-400 uppercase font-semibold mb-1">Clock Out</div>
                                              <div className="text-lg font-bold text-slate-800">{card.clockOut}</div>
                                              <div className="mt-1 flex items-center gap-1 text-slate-500 bg-white border border-slate-200 rounded px-1.5 py-1 font-mono w-fit">
                                                  <i data-lucide="map-pin" className="w-3 h-3"></i> -38.05, 145.25
                                              </div>
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
