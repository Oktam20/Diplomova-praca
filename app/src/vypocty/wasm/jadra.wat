;; Najťažšie výpočty spracovania v WebAssembly s SIMD (16 bajtov naraz).
;; Počítajú presne to isté ako JavaScript verzie v filtre.ts (bit po bite rovnako ako OpenCV),
;; JavaScript ich používa, keď prehliadač WebAssembly SIMD podporuje.
;; Prekladá sa pri `npm run build:worker` (scripts/build-worker.mjs) do jadra.generated.ts.
(module
  (memory (export "pamat") 1)

  ;; out[i] = max(out[i], zdroj[i]) (pri $max = 0 minimum) pre i = 0 .. n-1 (bajty).
  (func (export "kombinuj") (param $out i32) (param $zdroj i32) (param $n i32) (param $max i32)
    (local $i i32) (local $a i32) (local $b i32)
    (block $koniec
      (loop $slucka
        (br_if $koniec (i32.gt_s (i32.add (local.get $i) (i32.const 16)) (local.get $n)))
        (if (local.get $max)
          (then
            (v128.store (i32.add (local.get $out) (local.get $i))
              (i8x16.max_u (v128.load (i32.add (local.get $out) (local.get $i)))
                           (v128.load (i32.add (local.get $zdroj) (local.get $i))))))
          (else
            (v128.store (i32.add (local.get $out) (local.get $i))
              (i8x16.min_u (v128.load (i32.add (local.get $out) (local.get $i)))
                           (v128.load (i32.add (local.get $zdroj) (local.get $i)))))))
        (local.set $i (i32.add (local.get $i) (i32.const 16)))
        (br $slucka)))
    (block $koniec2
      (loop $zvysok
        (br_if $koniec2 (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $a (i32.load8_u (i32.add (local.get $out) (local.get $i))))
        (local.set $b (i32.load8_u (i32.add (local.get $zdroj) (local.get $i))))
        (i32.store8 (i32.add (local.get $out) (local.get $i))
          (select (local.get $a) (local.get $b)
            (if (result i32) (local.get $max)
              (then (i32.gt_u (local.get $a) (local.get $b)))
              (else (i32.lt_u (local.get $a) (local.get $b))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $zvysok))))

  ;; Vodorovný krok šedej morfológie: ciel[i] = max(zdroj[i - ch], zdroj[i], zdroj[i + ch]) (alebo minimum)
  ;; pre $h riadkov dĺžky $riadok; riadok y začína na y * krok + ch, pred ním a za ním je ch neutrálnych bajtov.
  (func (export "riadky") (param $zdroj i32) (param $ciel i32) (param $krok i32) (param $riadok i32)
                          (param $h i32) (param $ch i32) (param $max i32)
    (local $y i32) (local $i i32) (local $k i32) (local $a i32) (local $b i32) (local $c i32)
    (local $l v128) (local $s v128) (local $p v128)
    (block $koniecY
      (loop $riadky
        (br_if $koniecY (i32.ge_s (local.get $y) (local.get $h)))
        (local.set $i (i32.add (i32.mul (local.get $y) (local.get $krok)) (local.get $ch)))
        (local.set $k (i32.add (local.get $i) (local.get $riadok)))
        (block $koniecV
          (loop $vektory
            (br_if $koniecV (i32.gt_s (i32.add (local.get $i) (i32.const 16)) (local.get $k)))
            (local.set $l (v128.load (i32.sub (i32.add (local.get $zdroj) (local.get $i)) (local.get $ch))))
            (local.set $s (v128.load (i32.add (local.get $zdroj) (local.get $i))))
            (local.set $p (v128.load (i32.add (i32.add (local.get $zdroj) (local.get $i)) (local.get $ch))))
            (if (local.get $max)
              (then (v128.store (i32.add (local.get $ciel) (local.get $i))
                      (i8x16.max_u (i8x16.max_u (local.get $l) (local.get $s)) (local.get $p))))
              (else (v128.store (i32.add (local.get $ciel) (local.get $i))
                      (i8x16.min_u (i8x16.min_u (local.get $l) (local.get $s)) (local.get $p)))))
            (local.set $i (i32.add (local.get $i) (i32.const 16)))
            (br $vektory)))
        (block $koniecS
          (loop $skalarne
            (br_if $koniecS (i32.ge_s (local.get $i) (local.get $k)))
            (local.set $a (i32.load8_u (i32.sub (i32.add (local.get $zdroj) (local.get $i)) (local.get $ch))))
            (local.set $b (i32.load8_u (i32.add (local.get $zdroj) (local.get $i))))
            (local.set $c (i32.load8_u (i32.add (i32.add (local.get $zdroj) (local.get $i)) (local.get $ch))))
            (if (local.get $max)
              (then
                (local.set $a (select (local.get $a) (local.get $b) (i32.gt_u (local.get $a) (local.get $b))))
                (local.set $a (select (local.get $a) (local.get $c) (i32.gt_u (local.get $a) (local.get $c)))))
              (else
                (local.set $a (select (local.get $a) (local.get $b) (i32.lt_u (local.get $a) (local.get $b))))
                (local.set $a (select (local.get $a) (local.get $c) (i32.lt_u (local.get $a) (local.get $c))))))
            (i32.store8 (i32.add (local.get $ciel) (local.get $i)) (local.get $a))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $skalarne)))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $riadky))))

  ;; Vodorovný krok 8-bitového Gaussa: medzi (u16) = súčet k[j] * pixel v pevnej desatinnej čiarke (8 bitov).
  ;; $mapa: pre i = 0 .. w+2r-1 index stĺpca so započítaným okrajom (už vynásobený ch);
  ;; $jadro: i32 koeficienty dĺžky 2r+1; $buf: pomocný riadok ((w + 2r) * ch + 16 bajtov).
  ;; Súčty sa zmestia do 16 bitov (najviac 256 * 255), preto stačí i16x8 – 8 pixelov naraz.
  (func (export "gauss_h") (param $zdroj i32) (param $medzi i32) (param $mapa i32) (param $buf i32)
                           (param $jadro i32) (param $w i32) (param $h i32) (param $ch i32) (param $r i32)
    (local $riadok i32) (local $sirka i32) (local $y i32) (local $i i32) (local $c i32) (local $m i32)
    (local $p i32) (local $stred i32) (local $j i32) (local $d i32) (local $o i32) (local $sucet v128)
    (local.set $riadok (i32.mul (local.get $w) (local.get $ch)))
    (local.set $sirka (i32.add (local.get $w) (i32.shl (local.get $r) (i32.const 1))))
    (block $koniecY
      (loop $riadky
        (br_if $koniecY (i32.ge_s (local.get $y) (local.get $h)))
        (local.set $o (i32.add (local.get $zdroj) (i32.mul (local.get $y) (local.get $riadok))))
        ;; riadok s okrajom do $buf
        (local.set $i (i32.const 0))
        (block $koniecB
          (loop $buf
            (br_if $koniecB (i32.ge_s (local.get $i) (local.get $sirka)))
            (local.set $m (i32.add (local.get $o) (i32.load (i32.add (local.get $mapa) (i32.shl (local.get $i) (i32.const 2))))))
            (local.set $c (i32.const 0))
            (block $koniecC
              (loop $kanaly
                (br_if $koniecC (i32.ge_s (local.get $c) (local.get $ch)))
                (i32.store8 (i32.add (i32.add (local.get $buf) (i32.mul (local.get $i) (local.get $ch))) (local.get $c))
                            (i32.load8_u (i32.add (local.get $m) (local.get $c))))
                (local.set $c (i32.add (local.get $c) (i32.const 1)))
                (br $kanaly)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $buf)))
        ;; konvolúcia, 8 hodnôt naraz (posledná osmica môže zapísať do ďalšieho riadka – ten sa prepíše)
        (local.set $p (i32.const 0))
        (block $koniecP
          (loop $pixely
            (br_if $koniecP (i32.ge_s (local.get $p) (local.get $riadok)))
            (local.set $stred (i32.add (i32.add (local.get $buf) (local.get $p)) (i32.mul (local.get $r) (local.get $ch))))
            (local.set $sucet
              (i16x8.mul (v128.load8x8_u (local.get $stred))
                         (i16x8.splat (i32.load (i32.add (local.get $jadro) (i32.shl (local.get $r) (i32.const 2)))))))
            (local.set $j (i32.const 1))
            (local.set $d (local.get $ch))
            (block $koniecJ
              (loop $jadro
                (br_if $koniecJ (i32.gt_s (local.get $j) (local.get $r)))
                (local.set $sucet
                  (i16x8.add (local.get $sucet)
                    (i16x8.mul
                      (i16x8.add (v128.load8x8_u (i32.sub (local.get $stred) (local.get $d)))
                                 (v128.load8x8_u (i32.add (local.get $stred) (local.get $d))))
                      (i16x8.splat (i32.load (i32.add (local.get $jadro)
                                     (i32.shl (i32.add (local.get $r) (local.get $j)) (i32.const 2))))))))
                (local.set $j (i32.add (local.get $j) (i32.const 1)))
                (local.set $d (i32.add (local.get $d) (local.get $ch)))
                (br $jadro)))
            (v128.store (i32.add (local.get $medzi)
                                 (i32.shl (i32.add (i32.mul (local.get $y) (local.get $riadok)) (local.get $p)) (i32.const 1)))
                        (local.get $sucet))
            (local.set $p (i32.add (local.get $p) (i32.const 8)))
            (br $pixely)))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $riadky))))

  ;; Zvislý krok 8-bitového Gaussa: out = (súčet k[j] * medzi + 2^15) >> 16, najviac 255.
  ;; $riadky: pre každé y 2r+1 bajtových posunov riadkov y-r .. y+r v $medzi (s okrajom).
  ;; Súčty až 256 * 65280 sú v i32x4 – 8 pixelov naraz v dvoch štvoriciach.
  (func (export "gauss_v") (param $medzi i32) (param $out i32) (param $riadky i32) (param $jadro i32)
                           (param $riadok i32) (param $h i32) (param $r i32)
    (local $y i32) (local $p i32) (local $t i32) (local $j i32) (local $kk v128) (local $v v128)
    (local $a v128) (local $b v128) (local $lo v128) (local $hi v128) (local $o i32) (local $n i32)
    (local.set $n (i32.add (i32.shl (local.get $r) (i32.const 1)) (i32.const 1)))
    (block $koniecY
      (loop $riadkyY
        (br_if $koniecY (i32.ge_s (local.get $y) (local.get $h)))
        (local.set $t (i32.add (local.get $riadky) (i32.shl (i32.mul (local.get $y) (local.get $n)) (i32.const 2))))
        (local.set $p (i32.const 0))
        (block $koniecP
          (loop $pixely
            (br_if $koniecP (i32.ge_s (local.get $p) (local.get $riadok)))
            (local.set $o (i32.add (local.get $medzi) (i32.shl (local.get $p) (i32.const 1))))
            (local.set $kk (i32x4.splat (i32.load (i32.add (local.get $jadro) (i32.shl (local.get $r) (i32.const 2))))))
            (local.set $v (v128.load (i32.add (local.get $o)
                                     (i32.load (i32.add (local.get $t) (i32.shl (local.get $r) (i32.const 2)))))))
            (local.set $lo (i32x4.mul (i32x4.extend_low_i16x8_u (local.get $v)) (local.get $kk)))
            (local.set $hi (i32x4.mul (i32x4.extend_high_i16x8_u (local.get $v)) (local.get $kk)))
            (local.set $j (i32.const 1))
            (block $koniecJ
              (loop $jadro
                (br_if $koniecJ (i32.gt_s (local.get $j) (local.get $r)))
                (local.set $kk (i32x4.splat (i32.load (i32.add (local.get $jadro)
                                 (i32.shl (i32.add (local.get $r) (local.get $j)) (i32.const 2))))))
                (local.set $a (v128.load (i32.add (local.get $o)
                                (i32.load (i32.add (local.get $t) (i32.shl (i32.sub (local.get $r) (local.get $j)) (i32.const 2)))))))
                (local.set $b (v128.load (i32.add (local.get $o)
                                (i32.load (i32.add (local.get $t) (i32.shl (i32.add (local.get $r) (local.get $j)) (i32.const 2)))))))
                (local.set $lo (i32x4.add (local.get $lo)
                  (i32x4.mul (i32x4.add (i32x4.extend_low_i16x8_u (local.get $a)) (i32x4.extend_low_i16x8_u (local.get $b)))
                             (local.get $kk))))
                (local.set $hi (i32x4.add (local.get $hi)
                  (i32x4.mul (i32x4.add (i32x4.extend_high_i16x8_u (local.get $a)) (i32x4.extend_high_i16x8_u (local.get $b)))
                             (local.get $kk))))
                (local.set $j (i32.add (local.get $j) (i32.const 1)))
                (br $jadro)))
            (local.set $lo (i32x4.min_u (i32x4.shr_u (i32x4.add (local.get $lo) (i32x4.splat (i32.const 32768))) (i32.const 16))
                                        (i32x4.splat (i32.const 255))))
            (local.set $hi (i32x4.min_u (i32x4.shr_u (i32x4.add (local.get $hi) (i32x4.splat (i32.const 32768))) (i32.const 16))
                                        (i32x4.splat (i32.const 255))))
            (i64.store (i32.add (i32.add (local.get $out) (i32.mul (local.get $y) (local.get $riadok))) (local.get $p))
              (i64x2.extract_lane 0
                (i8x16.narrow_i16x8_u (i16x8.narrow_i32x4_u (local.get $lo) (local.get $hi))
                                      (i16x8.narrow_i32x4_u (local.get $lo) (local.get $hi)))))
            (local.set $p (i32.add (local.get $p) (i32.const 8)))
            (br $pixely)))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $riadkyY))))
)
