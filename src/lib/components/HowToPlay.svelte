<script lang="ts">
  export let onClose: () => void;

  let chapter = 0;
  const chapters = [
    {
      title: 'Your first few moves',
      intro: 'Build a working city, support its people, then raise an army and explore.',
      steps: [
        ['Find your capital', 'Press C to return home. Click a tile to inspect it; double-click your city center to open city management.'],
        ['Start with your economy', 'Select an empty tile in your city and choose Construct. Review the cost, production and build time before confirming. Farms produce food; mines produce gold.'],
        ['Prepare to explore', 'Keep an eye on food and population, build a barracks, then train a small batch of troops. Select your army to plan its first move.']
      ],
      tip: 'You can return to this guide at any time using the ? beside your username or the ? key.'
    },
    {
      title: 'Build & support your city',
      intro: 'A healthy economy gives you room to grow. Check both your resource stores and their flow rates.',
      steps: [
        ['Read your resources', 'Hover over or click the gold and food counters at the top to see income and upkeep. A large stockpile can still shrink when upkeep exceeds production.'],
        [
          'Keep residents fed',
          'Open city management to check local food flow, population growth and housing. Insufficient local food can cause population decline, even when you are focused on the shared food counter.'
        ],
        ['Upgrade with a purpose', 'Double-click a building to manage it. Review the next level’s benefits, cost and build time before choosing Upgrade. Construction and upgrades take time.'],
        [
          'Balance city policy',
          'City management lets you adjust taxes and militia. Higher taxes earn more gold but suppress growth. Militia defend locally and consume food without paying tax; core civilians cannot be recruited.'
        ]
      ],
      tip: 'A useful early habit: check food flow before expanding your population or army.'
    },
    {
      title: 'Train your first army',
      intro: 'Recruitment turns available residents and gold into troops. Start with a batch your city can support.',
      steps: [
        ['Open a completed barracks', 'Double-click your barracks to find City training. Choose a troop type and batch size, then check the gold and resident costs.'],
        ['Queue a batch', 'Choose Queue batch to reserve the costs immediately. Barracks in the same city share its training pipeline; the barracks lanes show what is currently training.'],
        ['Select your troops', 'When troops are ready, click their formation on the map or an army card to inspect them. Check troop composition and size before sending them into danger.']
      ],
      tip: 'Recruitable residents are only part of your population. Check the recruitment pool if you cannot queue the batch you want.'
    },
    {
      title: 'Explore, move & fight',
      intro: 'Inspect your destination and the route before committing an army.',
      steps: [
        ['Preview a move', 'Select one of your armies. Use Move or M to preview movement, or right-click a destination to bring up its route and confirmation.'],
        ['Confirm your destination', 'Right-click the same destination again to issue the order. Press Esc to cancel movement selection. Travel takes time; watch your army’s route and order status.'],
        ['Know what you are targeting', 'An order on a hostile army issues an attack. An order on a settlement center you do not own issues a siege. Check the defenders before committing.'],
        [
          'Use the information you have',
          'Unexplored territory is hidden, and remembered terrain does not reveal current occupants. Inspect active battles for progress and open the mailbox for battle reports.'
        ]
      ],
      tip: 'Explore cautiously: a remembered tile is not a guarantee that the route is still safe.'
    }
  ];
  const controls = [
    ['Pan the map', 'Hold arrows / WASD / HJKL, or drag'],
    ['Vim directions', 'H left · J down · K up · L right'],
    ['Pan faster', 'Hold Shift while moving'],
    ['Zoom', 'Mouse wheel / + / −'],
    ['Reset zoom', '0'],
    ['Return to capital', 'C'],
    ['Cycle your cities', '[ / ]'],
    ['Inspect a tile or army', 'Click tile / formation / army card'],
    ['Manage a building', 'Double-click building'],
    ['Preview army movement', 'Move button / M'],
    ['Confirm army movement', 'Right-click destination twice'],
    ['Cancel move / close / deselect', 'Esc'],
    ['Open how to play', '?']
  ];

  const showDialog = (node: HTMLDialogElement) => {
    node.showModal();
    return { destroy: () => node.close() };
  };
</script>

<dialog
  use:showDialog
  on:close={onClose}
  aria-labelledby="how-to-play-title"
  aria-describedby="how-to-play-description"
  class="m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100vw-1.5rem))] max-w-none overflow-y-auto border border-[#465a5f] bg-[#172427] p-0 text-[#dce5df] shadow-2xl backdrop:bg-black/65"
>
  <header class="flex items-start justify-between gap-4 border-b border-white/[0.09] p-5 sm:px-7">
    <div>
      <p class="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-200/70">Field guide</p>
      <h1 id="how-to-play-title" class="text-xl font-semibold">How to play</h1>
      <p id="how-to-play-description" class="mt-1 text-xs text-[#9aaba2]">A quick start to life in city.io.</p>
    </div>
    <button class="flex h-9 w-9 shrink-0 items-center justify-center border border-white/10 text-xl text-[#a5b2aa] hover:bg-white/5 hover:text-white" aria-label="Close how to play" on:click={onClose}
      >×</button
    >
  </header>

  <nav aria-label="Guide chapters" class="flex flex-wrap gap-1.5 border-b border-white/[0.09] px-5 py-3 sm:px-7">
    {#each ['Start here', 'Your city', 'Training', 'The map', 'Controls'] as label, index}
      <button
        class="border px-3 py-2 text-xs transition-colors {chapter === index
          ? 'border-emerald-200/30 bg-emerald-200/10 text-emerald-100'
          : 'border-transparent text-[#9aaba2] hover:bg-white/5 hover:text-white'}"
        aria-current={chapter === index ? 'step' : undefined}
        on:click={() => (chapter = index)}>{label}</button
      >
    {/each}
  </nav>

  <div class="px-5 py-6 sm:px-7" aria-live="polite">
    {#if chapter < chapters.length}
      {@const current = chapters[chapter]}
      <h2 class="text-lg font-medium">{current.title}</h2>
      <p class="mt-2 text-sm leading-relaxed text-[#a5b2aa]">{current.intro}</p>
      <ol class="mt-6 space-y-5">
        {#each current.steps as [title, description], index}
          <li class="flex gap-3">
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200/20 text-[11px] text-emerald-200" aria-hidden="true">{index + 1}</span>
            <div>
              <h3 class="text-sm font-medium">{title}</h3>
              <p class="mt-1 text-sm leading-relaxed text-[#a5b2aa]">{description}</p>
            </div>
          </li>
        {/each}
      </ol>
      <p class="mt-6 border-l-2 border-emerald-200/40 bg-emerald-200/[0.04] px-3 py-2.5 text-xs leading-relaxed text-[#b8c8bf]">{current.tip}</p>
    {:else}
      <h2 class="text-lg font-medium">Make yourself at home</h2>
      <p class="mt-2 text-sm text-[#a5b2aa]">Hold movement keys for a continuous pan. Zoom follows your mouse cursor.</p>
      <dl class="mt-5 divide-y divide-white/[0.07]">
        {#each controls as [label, keys]}
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-xs">
            <dt class="text-[#a5b2aa]">{label}</dt>
            <dd class="text-right text-[#e0e9df]">{keys}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  </div>

  <footer class="flex items-center justify-between gap-3 border-t border-white/[0.09] px-5 py-4 sm:px-7">
    <span class="text-xs text-[#9aaba2]">{chapter + 1} / 5</span>
    <div class="flex gap-2">
      {#if chapter > 0}<button class="border border-white/10 px-4 py-2 text-xs hover:bg-white/5" on:click={() => (chapter -= 1)}>Back</button>{/if}
      <button class="border border-emerald-200/30 bg-emerald-200/10 px-4 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-200/20" on:click={() => (chapter < 4 ? (chapter += 1) : onClose())}>
        {chapter < 4 ? 'Next' : 'Back to my city'}
      </button>
    </div>
  </footer>
</dialog>
