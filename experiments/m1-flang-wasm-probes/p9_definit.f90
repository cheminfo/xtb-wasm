program p
  implicit none
  type :: t
    integer :: n = 42
    real :: r = 3.5
    character(len=:), allocatable :: name
  end type
  type(t), allocatable :: b
  allocate(b)
  print '(a,i0)', "default-init n (expect 42) = ", b%n
  print '(a,f6.2)', "default-init r (expect 3.50) = ", b%r
  print '(a,l1)', "allocated(b%name) (expect F) = ", allocated(b%name)
end program
