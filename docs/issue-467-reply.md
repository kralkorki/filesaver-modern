#467 "Can't 'open in' Chrome iOS" — cevap

**Not:** Bu bir community çalışmasıdır. Eli Grey'in projesi değildir, onun yerine geçmeye çalışmıyor; yalnızca bu issue'nun 8 yıldır cevapsız kalan sorusunu cevaplamaya çalışıyoruz.

---

Bu issue'yu bulduğunuz için teşekkürler — ve bu, Eli Grey'in orijinal deposunda 7 yıldır açık duran bir issue. Aynı soruyu soran #581, #686 ve #479 dahil toplam ~56 yorum birikmiş durumda.

## Neden oluyor

Kısa cevap: **iOS'ta bu bir hata değil, bir tarayıcı kısıtı.**

Safari ve iOS Safari, `blob:` adresinden indirme yapılmasını bilinçli olarak engelliyor. Orijinal kütüphane (2013 yazıldı) şu stratejiyi kullanıyor: `URL.createObjectURL(blob)` ile geçici bir adres üret, görünmez bir `<a download>` oluştur, tıkla. Bu, masaüstünde çalışır — ama iOS'ta tıklama dosyayı indirmek yerine yeni sekmede açar.

Yani "daha doğru bir `<a>` etiketi" ile bu çözülemez. Sorun etikette değil, platformun `blob:` indirmelerini reddetmesinde.

## Çözüm: Web Share API

iPhone'da doğru cevap `navigator.share()` kullanmak. Bu, dosyayı sistemin paylaş menüsüne verir; kullanıcı oradan **Dosyalar**, AirDrop ya da istediği uygulamaya kaydedebilir.

```js
const file = new File([blob], 'rapor.csv', { type: 'text/csv' });

if (navigator.canShare && navigator.canShare({ files: [file] })) {
  await navigator.share({ files: [file] });
}
```

Bu, `saveAs()` içinde bir "varsayılan yol" değil — iOS'ta **tek doğru yol**.

## Durum

Düzeltmeyi içeren paketi yayınladık:

**https://github.com/kralkorki/filesaver-modern**

- API birebir aynı: `saveAs(blob, name, opts)` — mevcut kodunuz değişmeden çalışır
- MİT lisanslı, sıfır bağımlılık
- `saveAs()` artık sırayla dener: `showSaveFilePicker()` → `navigator.share()` → `<a download>` → blob gezinmesi
- Masaüstü davranışı değişmedi; iOS'ta paylaş menüsü açılıyor

```diff
- import { saveAs } from 'file-saver';
+ import { saveAs } from 'filesaver-modern';
```

## İki ek düzeltme

Bunları yol üstünde bulduk:

1. **`autoBom` hiç çalışmıyordu.** MIME alt türü için `\S*` kullanılıyordu; bu `;` üzerinde açgözlü davranıp `charset=utf-8`'i yutuyor, sonra onu arayamıyordu. Sonuç: Excel için BOM ekleme özelliği sessizce hiç çalışmıyordu. Gerçek tarayıcıda doğrulandı — artık dosya `ef bb bf` ile başlıyor.
2. **Her string kaydında senkron XHR** yapılıyordu; ana iş parçacığını bloklayan, kullanımdan kaldırılmış bir API.

## Eli'se

Eli, bu düzeltmeler geriye uyumlu. Orijinal depoya PR açmak bizim için de en iyi sonuç olur — milyonlarca kurulum oradan fayda görür. İlgilenirseniz PR'yi memnuniyetle hazırlarız; kabul edilmese de sorun çözülmüş olur.

Bu yorumu spam olarak değil, sorunuza cevap olarak bırakıyorum. Orijinal kütüphaneye saygımız tamdır ve burada sahiplenmediğimiz açıkça belirtilmiştir.