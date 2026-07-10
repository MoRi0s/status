window.addEventListener('DOMContentLoaded', () => {

  const hasPlayed = sessionStorage.getItem("openingPlayed");

  const opening = document.getElementById("opening");
  const video = document.getElementById("openingvideo");

  // すでに再生済みなら即消す
  if (hasPlayed) {
    opening.remove();
    return;
  }

  video.addEventListener("ended", () => {

    opening.style.transition = "opacity 0.8s ease";
    opening.style.opacity = "0";
    opening.style.pointerEvents = "none";

    // 再生済みフラグ保存（このタブだけ有効）
    sessionStorage.setItem("openingPlayed", "true");

    setTimeout(() => {
      opening.remove();
    }, 900);

  });

});


const menuToggle = document.getElementById("menuToggle");
const menuBar = document.querySelector(".menu-bar");

let scrollY = 0;

function openMenu() {
  menuBar.classList.add("active");
  menuToggle.textContent = "×";

  scrollY = window.scrollY;

  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = "100%";
}

function closeMenu() {
  menuBar.classList.remove("active");
  menuToggle.textContent = "☰";

  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";

  window.scrollTo(0, scrollY);
}

// ボタン
menuToggle.addEventListener("click", () => {
  const isOpen = menuBar.classList.contains("active");
  isOpen ? closeMenu() : openMenu();
});

// 背景クリック（ここ重要）
menuBar.addEventListener("click", (e) => {
  if (e.target === menuBar) {
    closeMenu();
  }
});