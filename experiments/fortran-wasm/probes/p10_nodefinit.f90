program p
  implicit none
  type :: t
    integer :: n = 42
  end type
  type(t), allocatable :: b
  allocate(b)
  print '(a,i0)', "no-alloc-comp default-init n (expect 42) = ", b%n
end program
