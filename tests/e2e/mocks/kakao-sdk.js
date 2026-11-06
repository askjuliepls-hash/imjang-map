// 테스트 전용 가짜 카카오 지도 SDK. 실제 지도 대신 격자 배경과 '가짜 지도' 표시를 그립니다.
// 앱이 쓰는 기능(LatLng, Map, Marker, CustomOverlay, event, services.Places)만 흉내 냅니다.
(function () {
  function LatLng(lat, lng) { this.lat = lat; this.lng = lng; }
  LatLng.prototype.getLat = function () { return this.lat; };
  LatLng.prototype.getLng = function () { return this.lng; };

  var handlers = new WeakMap();
  var event = {
    addListener: function (target, type, fn) {
      var m = handlers.get(target) || {};
      (m[type] = m[type] || []).push(fn);
      handlers.set(target, m);
    },
    trigger: function (target, type, arg) {
      var m = handlers.get(target) || {};
      (m[type] || []).forEach(function (fn) { fn(arg); });
    },
  };

  function Map(el, opts) {
    this.el = el;
    this.center = opts.center;
    this.level = opts.level;
    el.style.background =
      'repeating-linear-gradient(0deg, rgba(120,140,130,.18) 0 1px, transparent 1px 48px),' +
      'repeating-linear-gradient(90deg, rgba(120,140,130,.18) 0 1px, transparent 1px 48px), #eef2ec';
    var tag = document.createElement('div');
    tag.textContent = '가짜 지도 (테스트)';
    tag.style.cssText = 'position:absolute;left:10px;bottom:10px;font:12px sans-serif;color:#5b6b63;background:rgba(255,255,255,.8);padding:2px 6px;border-radius:4px';
    el.appendChild(tag);
    var self = this;
    el.addEventListener('click', function (e) {
      var r = el.getBoundingClientRect();
      var scale = 40000;
      var lng = self.center.lng + (e.clientX - r.left - r.width / 2) / scale;
      var lat = self.center.lat - (e.clientY - r.top - r.height / 2) / scale;
      event.trigger(self, 'click', { latLng: new LatLng(lat, lng) });
    });
    setTimeout(function () { event.trigger(self, 'tilesloaded'); }, window.__mockTilesDelay || 60);
  }
  Map.prototype.setCenter = function (c) { this.center = c; this._redraw(); };
  Map.prototype.panTo = function (c) { this.center = c; this._redraw(); };
  Map.prototype.setLevel = function (l) { this.level = l; };
  Map.prototype.relayout = function () {};
  Map.prototype.getCenter = function () { return this.center; };
  Map.prototype._items = null;
  Map.prototype._add = function (item) { (this._items = this._items || []).push(item); };
  Map.prototype._redraw = function () { (this._items || []).forEach(function (i) { i._draw(); }); };

  function project(map, ll) {
    var r = map.el.getBoundingClientRect();
    var scale = 40000; // 1도당 픽셀(대략)
    return {
      x: r.width / 2 + (ll.lng - map.center.lng) * scale,
      y: r.height / 2 - (ll.lat - map.center.lat) * scale,
    };
  }

  function Marker(o) {
    this.map = null;
    this.pos = o.position;
    this.el = document.createElement('div');
    this.el.className = 'mock-marker';
    if (o.image) this.el.dataset.image = o.image.src;
    var marker = this;
    this.el.addEventListener('click', function (e) {
      e.stopPropagation();
      event.trigger(marker, 'click');
    });
    this.el.style.cssText = 'position:absolute;width:24px;height:24px;margin:-26px 0 0 -12px;background:#e5483b;border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 4px rgba(0,0,0,.3)';
    this.setMap(o.map);
  }
  Marker.prototype._draw = function () {
    if (!this.map) { this.el.remove(); return; }
    var p = project(this.map, this.pos);
    this.el.style.left = p.x + 'px';
    this.el.style.top = p.y + 'px';
    if (!this.el.isConnected) this.map.el.appendChild(this.el);
  };
  Marker.prototype.setPosition = function (p) { this.pos = p; this._draw(); };
  Marker.prototype.setMap = function (m) { this.map = m; if (m) m._add(this); this._draw(); };

  function CustomOverlay(o) {
    this.map = null;
    this.pos = o.position;
    this.wrap = document.createElement('div');
    this.wrap.style.cssText = 'position:absolute;transform:translate(-50%,-50%)';
    if (typeof o.content === 'string') this.wrap.innerHTML = o.content; else this.wrap.appendChild(o.content);
    this.setMap(o.map);
  }
  CustomOverlay.prototype._draw = Marker.prototype._draw;
  CustomOverlay.prototype.setPosition = function (p) { this.pos = p; this._draw(); };
  CustomOverlay.prototype.setMap = function (m) { this.map = m; this.el = this.wrap; if (m) m._add(this); this._draw(); };

  var Status = { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' };
  function Places() {}
  function Geocoder() {}
  Geocoder.prototype.coord2Address = function (lng, lat, cb) {
    setTimeout(function () {
      if (window.__mockNoAddress) { cb([], Status.ZERO_RESULT); return; }
      cb([{ road_address: { address_name: '경기도 성남시 중원구 가짜대로 10' }, address: { address_name: '경기 성남시 중원구 가짜동 3' } }], Status.OK);
    }, window.__mockAddressDelay || 20);
  };
  Places.prototype.keywordSearch = function (q, cb, options) {
    var self = this;
    (window.__searchCalls = window.__searchCalls || []).push(options);
    setTimeout(function () {
      if (/없는장소/.test(q)) { cb([], Status.ZERO_RESULT, { totalCount: 0 }); return; }
      if (/많은장소/.test(q)) {
        // 전국 순위 3쪽. 찾는 곳은 마지막 쪽에 있고, 지도 근처 검색에도 나옵니다.
        self.page = (self.page || 0) + 1;
        var page = options.location ? 1 : self.page;
        var list = [];
        for (var i = 0; i < 15; i++) {
          list.push({ id: 'p' + page + '-' + i, place_name: '많은장소 먼곳', address_name: '먼시 먼구 ' + i, road_address_name: '', x: String(120 + i), y: '30' });
        }
        if (page === 3 || options.location) list[0] = { id: 'wanted', place_name: '많은장소 찾는곳', address_name: '경기 성남시 중원구 가짜동 3', road_address_name: '', x: '126.98', y: '37.57' };
        cb(list, Status.OK, { totalCount: 45, hasNextPage: !options.location && page < 3, nextPage: function () { self.keywordSearch(q, cb, options); } });
        return;
      }
      cb([
        { place_name: '테스트 장소 A', road_address_name: '테스트시 테스트구 가짜로 1', address_name: '', x: '126.9800', y: '37.5672' },
        { place_name: '테스트 장소 B', road_address_name: '', address_name: '테스트시 테스트구 가짜동 2', x: '126.9760', y: '37.5650' },
      ], Status.OK, { totalCount: 2 });
    }, (window.__mockSearchDelay || {})[q] || 80); // 검색어별로 답을 늦춥니다. 늦은 답 점검에 씁니다.
  };

  window.kakao = {
    maps: {
      load: function (cb) { setTimeout(cb, 10); },
      LatLng: LatLng, Map: Map, Marker: Marker, MarkerImage: function (src) { this.src = src; }, Size: function () {}, Point: function () {}, CustomOverlay: CustomOverlay, event: event,
      services: { Places: Places, Status: Status, Geocoder: Geocoder, SortBy: { ACCURACY: 'ACCURACY', DISTANCE: 'DISTANCE' } },
    },
  };
})();
